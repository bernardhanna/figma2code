import { PNG } from "pngjs";
import fs from "fs";

export function computeElementDiff(diffPngPath, layout, outPath) {
  const img = PNG.sync.read(fs.readFileSync(diffPngPath));
  const offenders = [];

  for (const el of layout) {
    const { x, y, w, h } = el.bbox;
    let diffPixels = 0;
    let total = Math.max(1, Math.floor(w * h));

    for (let iy = Math.floor(y); iy < y + h; iy++) {
      for (let ix = Math.floor(x); ix < x + w; ix++) {
        const idx = (img.width * iy + ix) << 2;
        if (img.data[idx + 3] > 0) diffPixels++;
      }
    }

    if (diffPixels > 0) {
      offenders.push({
        nodeId: el.nodeId,
        pixels: diffPixels,
        ratio: diffPixels / total,
      });
    }
  }

  offenders.sort((a, b) => b.ratio - a.ratio);
  fs.writeFileSync(outPath, JSON.stringify(offenders, null, 2));
}
