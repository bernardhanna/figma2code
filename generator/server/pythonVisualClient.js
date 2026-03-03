// Optional Python visual analysis bridge (SSIM + diff clustering).
// If disabled/unavailable, callers should continue with JS diff pipeline.

function isTruthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function isPythonVisualEnabled() {
  return isTruthy(process.env.VISUAL_PY_ENABLE);
}

export function pythonVisualServiceUrl() {
  const raw = String(process.env.VISUAL_PY_URL || "http://127.0.0.1:8091").trim();
  return raw.replace(/\/+$/, "");
}

function clampFinite(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function buildAlignedComparedPngs({ PNG, figmaPng, renderPng, dx = 0, dy = 0 }) {
  const figX = Math.max(0, Number(dx || 0));
  const figY = Math.max(0, Number(dy || 0));
  const renderX = Math.max(0, -Number(dx || 0));
  const renderY = Math.max(0, -Number(dy || 0));
  const w = Math.min(figmaPng.width - figX, renderPng.width - renderX);
  const h = Math.min(figmaPng.height - figY, renderPng.height - renderY);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const baseline = new PNG({ width: w, height: h });
  const output = new PNG({ width: w, height: h });
  PNG.bitblt(figmaPng, baseline, figX, figY, w, h, 0, 0);
  PNG.bitblt(renderPng, output, renderX, renderY, w, h, 0, 0);
  return { baseline, output, compared: { width: w, height: h } };
}

function decodeMaskPng(maskBase64) {
  const raw = String(maskBase64 || "").trim();
  if (!raw) return null;
  try {
    return Buffer.from(raw, "base64");
  } catch {
    return null;
  }
}

export async function analyzeWithPythonVisual({
  baselinePngBuffer,
  outputPngBuffer,
  breakpoint = "desktop",
  metadata = {},
  timeoutMs = 2500,
}) {
  if (!isPythonVisualEnabled()) return null;

  const serviceUrl = pythonVisualServiceUrl();
  const endpoint = `${serviceUrl}/analyze`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, Number(timeoutMs || 2500)));
  try {
    const form = new FormData();
    form.append("baseline", new Blob([baselinePngBuffer], { type: "image/png" }), "baseline.png");
    form.append("output", new Blob([outputPngBuffer], { type: "image/png" }), "output.png");
    form.append("breakpoint", String(breakpoint || "desktop"));
    form.append("metadata", JSON.stringify(metadata || {}));
    form.append("includeMask", "1");

    const resp = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    if (!json || typeof json !== "object") return null;

    const maskBuffer = decodeMaskPng(json.diffMaskPngBase64);
    const offenders = Array.isArray(json.offenders) ? json.offenders : [];
    return {
      ssim: clampFinite(json.ssim, NaN),
      diffRatio: clampFinite(json.diffRatio, NaN),
      diffPixels: clampFinite(json.diffPixels, NaN),
      totalPixels: clampFinite(json.totalPixels, NaN),
      offenders,
      hints: json.hints && typeof json.hints === "object" ? json.hints : {},
      diffMaskPngBuffer: maskBuffer,
      source: "python",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

