import { PNG } from "pngjs";
import fs from "fs";

export function computeElementDiff(diffPngPath, layout, outPath, options = {}) {
  const img = PNG.sync.read(fs.readFileSync(diffPngPath));
  const offenders = [];
  const minBboxArea = Math.max(0, Number(options?.minBboxArea ?? 200));

  for (const el of layout) {
    const { x, y, w, h } = el.bbox;
    const bboxArea = Math.max(0, Number(w || 0) * Number(h || 0));
    if (bboxArea < minBboxArea) continue;
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
        if (img.data[idx + 3] > 0) diffPixels++;
      }
    }

    if (diffPixels > 0) {
      const total = Math.max(1, sampledPixels);
      const ratio = Math.min(1, Math.max(0, diffPixels / total));
      offenders.push({
        nodeId: el.nodeId,
        pixels: diffPixels,
        ratio,
      });
    }
  }

  offenders.sort((a, b) => (b.pixels - a.pixels) || (b.ratio - a.ratio));
  fs.writeFileSync(outPath, JSON.stringify(offenders, null, 2));
}
