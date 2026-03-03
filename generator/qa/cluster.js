// generator/qa/cluster.js — Turn diff mask + layout into offender rectangles with severity

import fs from "node:fs";
import { PNG } from "pngjs";

/**
 * For each layout element, count diff pixels in its bbox; return rects with area and severity.
 * layout: array of { nodeId, dataKey, bbox: { x, y, w, h } }
 * diffPngPath: path to diff PNG (non-zero alpha = diff pixel)
 * Returns [{ x, y, w, h, area, severity, nodeId, dataKey }] sorted by severity descending.
 */
export function clusterOffendersFromLayout(diffPngPath, layout, options = {}) {
  if (!layout || !Array.isArray(layout) || layout.length === 0) return [];

  let img;
  try {
    const buf = fs.readFileSync(diffPngPath);
    img = PNG.sync.read(buf);
  } catch {
    return [];
  }

  const minBboxArea = Math.max(0, Number(options?.minBboxArea ?? 200));
  const offenders = [];

  for (const el of layout) {
    const bbox = el?.bbox;
    if (!bbox) continue;
    const x = Number(bbox.x ?? 0);
    const y = Number(bbox.y ?? 0);
    const w = Number(bbox.w ?? 0);
    const h = Number(bbox.h ?? 0);
    const area = w * h;
    if (area < minBboxArea) continue;

    const startX = Math.max(0, Math.floor(x));
    const startY = Math.max(0, Math.floor(y));
    const endX = Math.min(img.width, Math.ceil(x + w));
    const endY = Math.min(img.height, Math.ceil(y + h));
    if (endX <= startX || endY <= startY) continue;

    let diffPixels = 0;
    let sampledPixels = 0;
    for (let iy = startY; iy < endY; iy++) {
      for (let ix = startX; ix < endX; ix++) {
        sampledPixels += 1;
        const idx = (img.width * iy + ix) << 2;
        if (img.data[idx + 3] > 0) diffPixels += 1;
      }
    }

    if (diffPixels > 0) {
      const total = Math.max(1, sampledPixels);
      const severity = Math.min(1, diffPixels / total);
      offenders.push({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        area: Math.round(area),
        severity,
        diffPixels,
        nodeId: el?.nodeId ?? "",
        dataKey: el?.dataKey ?? "",
      });
    }
  }

  offenders.sort((a, b) => (b.severity - a.severity) || (b.diffPixels - a.diffPixels) || (b.area - a.area));
  return offenders;
}
