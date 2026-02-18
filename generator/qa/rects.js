// generator/qa/rects.js — Capture DOM bounding rects keyed by data-key / nodeId per breakpoint

import fs from "node:fs";
import path from "node:path";
import { captureLayoutJson } from "../server/visualDiffLayoutCapture.js";
import { loadCompareDeps } from "../server/visualDiffDeps.js";
import { BREAKPOINTS } from "./constants.js";

/**
 * Build a stable key for a node: prefer data-key, else nodeId.
 */
function stableKey(el) {
  const dk = String(el?.dataKey ?? "").trim();
  if (dk) return dk;
  return String(el?.nodeId ?? "").trim();
}

/**
 * Capture layout at viewport and export rects map: key -> { x, y, w, h }.
 * Writes rects-<bucket>.json to outDir.
 */
export async function captureRectsAtBreakpoint({ chromium, slug, port, outDir, bucket, waitMs = 80 }) {
  const viewport = BREAKPOINTS[bucket] || BREAKPOINTS.desktop;
  const layout = await captureLayoutJson({
    chromium,
    slug,
    port,
    outDir,
    viewport,
    waitMs,
  });

  const rects = {};
  for (const el of layout || []) {
    const key = stableKey(el);
    if (!key) continue;
    const b = el?.bbox;
    if (!b || typeof b.x !== "number" || typeof b.y !== "number") continue;
    rects[key] = {
      x: Number(b.x),
      y: Number(b.y),
      w: Number(b.w ?? 0),
      h: Number(b.h ?? 0),
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const filename = `rects-${String(bucket || "desktop").toLowerCase()}.json`;
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(rects, null, 2), "utf8");
  return { rects, filepath, layout };
}

/**
 * Capture rects at all breakpoints; save rects-desktop.json, rects-tablet.json, rects-mobile.json.
 */
export async function captureRectsAllBreakpoints({ chromium, slug, port, outDir, waitMs = 80 }) {
  const result = {};
  for (const bucket of ["desktop", "tablet", "mobile"]) {
    const { rects, filepath, layout } = await captureRectsAtBreakpoint({
      chromium,
      slug,
      port,
      outDir,
      bucket,
      waitMs,
    });
    result[bucket] = { rects, filepath, layout };
  }
  return result;
}
