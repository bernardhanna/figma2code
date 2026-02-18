import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

import {
  classifyFailure,
  computeLayoutDiff,
  findBestAlignment,
} from "../compareMetrics.js";

function makePng(w, h, painter) {
  const png = new PNG({ width: w, height: h });
  if (typeof painter === "function") painter(png);
  return png;
}

function drawRect(png, x0, y0, w, h, rgba = [255, 255, 255, 255]) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const idx = (png.width * y + x) << 2;
      png.data[idx + 0] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
}

test("alignment search reduces diff for shifted image", () => {
  const figma = makePng(128, 128, (png) => {
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const idx = (png.width * y + x) << 2;
        const stripe = Math.floor(x / 4) % 2 === 0;
        png.data[idx + 0] = stripe ? 240 : 30;
        png.data[idx + 1] = stripe ? 80 : 220;
        png.data[idx + 2] = stripe ? 120 : 60;
        png.data[idx + 3] = 255;
      }
    }
  });
  const render = makePng(128, 128, (png) => {
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const sx = x - 8; // shifted +8 x
        const idx = (png.width * y + x) << 2;
        if (sx < 0 || sx >= png.width) {
          png.data[idx + 0] = 0;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
          png.data[idx + 3] = 255;
          continue;
        }
        const stripe = Math.floor(sx / 4) % 2 === 0;
        png.data[idx + 0] = stripe ? 240 : 30;
        png.data[idx + 1] = stripe ? 80 : 220;
        png.data[idx + 2] = stripe ? 120 : 60;
        png.data[idx + 3] = 255;
      }
    }
  });
  const unaligned = findBestAlignment(render, figma, {
    searchPx: 0,
    searchStep: 1,
    searchScale: 0.5,
    threshold: 0.1,
    includeAA: true,
    pixelmatch,
  });
  const aligned = findBestAlignment(render, figma, {
    searchPx: 16,
    searchStep: 1,
    searchScale: 0.5,
    threshold: 0.1,
    includeAA: true,
    pixelmatch,
  });
  assert.ok(aligned.diffPixels <= unaligned.diffPixels);
  assert.equal(aligned.alignmentSearched, true);
  assert.ok(Math.abs(Number(aligned.bestDx || 0)) >= 5);
});

test("layout diff is lower than full diff for high-frequency aa-like noise", () => {
  const figma = makePng(128, 128, (png) => {
    drawRect(png, 20, 20, 80, 80, [255, 255, 255, 255]);
  });
  const render = makePng(128, 128, (png) => {
    drawRect(png, 20, 20, 80, 80, [255, 255, 255, 255]);
    // Add high-frequency checker noise.
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        if ((x + y) % 2 !== 0) continue;
        const idx = (png.width * y + x) << 2;
        png.data[idx + 0] = 120;
        png.data[idx + 1] = 120;
        png.data[idx + 2] = 120;
        png.data[idx + 3] = 255;
      }
    }
  });
  const aligned = findBestAlignment(render, figma, {
    searchPx: 0,
    searchStep: 1,
    searchScale: 0.5,
    threshold: 0.01,
    includeAA: true,
    pixelmatch,
  });
  const layout = computeLayoutDiff(render, figma, aligned.bestDx, aligned.bestDy, {
    layoutScale: 0.35,
    threshold: 0.01,
    includeAA: true,
    pixelmatch,
  });
  assert.ok(Number(layout.layoutDiffPixels) < Number(aligned.diffPixels));
});

test("classifyFailure returns expected categories", () => {
  const off = classifyFailure({
    bestDx: 8,
    bestDy: 0,
    diffRatio: 0.2,
    layoutDiffRatio: 0.19,
    layoutScore: { conflictingWidthCount: 0 },
    wrongLayoutModel: false,
  });
  assert.equal(off.failureMode, "offsetDominated");

  const aa = classifyFailure({
    bestDx: 0,
    bestDy: 0,
    diffRatio: 0.2,
    layoutDiffRatio: 0.08,
    layoutScore: { conflictingWidthCount: 0 },
    wrongLayoutModel: false,
  });
  assert.equal(aa.failureMode, "aaDominated");

  const width = classifyFailure({
    bestDx: 0,
    bestDy: 0,
    diffRatio: 0.2,
    layoutDiffRatio: 0.19,
    layoutScore: { conflictingWidthCount: 3 },
    wrongLayoutModel: false,
  });
  assert.equal(width.failureMode, "constraintConflict");
  assert.ok(Number(width?.failureSignals?.conflictingWidthCount || 0) > 0);
});

