from __future__ import annotations

import base64
import json
from typing import Any, Dict, List

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from skimage.metrics import structural_similarity as ssim


app = FastAPI(title="figma2wp visual python service", version="0.1.0")


def _decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("invalid image data")
    return img


def _encode_png_b64(mask: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", mask)
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _compute_hints(rects: List[Dict[str, Any]], diff_ratio: float, ssim_score: float) -> Dict[str, Any]:
    if not rects:
        return {
            "classification": "clean",
            "offenderCount": 0,
            "highDiff": diff_ratio > 0.12,
            "lowSsim": ssim_score < 0.85,
        }
    max_area = max(float(r.get("area", 0)) for r in rects)
    return {
        "classification": "layout-heavy" if max_area > 15000 else "fine-grained",
        "offenderCount": len(rects),
        "largestArea": max_area,
        "highDiff": diff_ratio > 0.12,
        "lowSsim": ssim_score < 0.85,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "visual-python"}


@app.post("/analyze")
async def analyze(
    baseline: UploadFile = File(...),
    output: UploadFile = File(...),
    bp: str = Form("desktop", alias="breakpoint"),
    metadata: str = Form("{}"),
    includeMask: str = Form("1"),
) -> JSONResponse:
    try:
        base_bytes = await baseline.read()
        out_bytes = await output.read()
        base_img = _decode_image(base_bytes)
        out_img = _decode_image(out_bytes)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"image decode failed: {exc}") from exc

    if base_img.shape[:2] != out_img.shape[:2]:
        out_img = cv2.resize(out_img, (base_img.shape[1], base_img.shape[0]), interpolation=cv2.INTER_AREA)

    base_gray = cv2.cvtColor(base_img, cv2.COLOR_BGR2GRAY)
    out_gray = cv2.cvtColor(out_img, cv2.COLOR_BGR2GRAY)

    score, diff = ssim(base_gray, out_gray, full=True)
    diff_u8 = np.clip((1.0 - diff) * 255.0, 0, 255).astype(np.uint8)
    _, mask = cv2.threshold(diff_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    rects: List[Dict[str, Any]] = []
    total_pixels = int(mask.shape[0] * mask.shape[1])
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = int(w * h)
        if area < 64:
            continue
        roi = mask[y : y + h, x : x + w]
        severity = float(np.count_nonzero(roi) / max(1, area))
        rects.append(
            {
                "x": int(x),
                "y": int(y),
                "w": int(w),
                "h": int(h),
                "area": area,
                "severity": round(severity, 6),
            }
        )

    rects.sort(key=lambda r: (r["severity"], r["area"]), reverse=True)

    diff_pixels = int(np.count_nonzero(mask))
    diff_ratio = float(diff_pixels / max(1, total_pixels))
    include_mask = str(includeMask or "1").strip() not in {"0", "false", "False"}
    try:
        parsed_meta = json.loads(metadata) if metadata else {}
    except Exception:
        parsed_meta = {}

    payload: Dict[str, Any] = {
        "ssim": float(score),
        "diffPixels": diff_pixels,
        "totalPixels": total_pixels,
        "diffRatio": diff_ratio,
        "offenders": rects,
        "hints": _compute_hints(rects, diff_ratio, float(score)),
        "breakpoint": str(bp or "desktop"),
        "metadata": parsed_meta if isinstance(parsed_meta, dict) else {},
    }
    if include_mask:
        payload["diffMaskPngBase64"] = _encode_png_b64(mask)
    return JSONResponse(payload)

