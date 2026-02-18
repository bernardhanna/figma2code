// generator/qa/diff.js — Pixel diff vs design reference, score and diff image per breakpoint

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { loadCompareDeps } from "../server/visualDiffDeps.js";
import { findBestAlignment } from "../server/compareMetrics.js";
import { DEFAULT_THRESHOLD } from "./constants.js";

/**
 * Resolve design reference PNG path for a breakpoint.
 * Prefer figma.<mode>.png, then figma.png, in outDir or a provided figmaDir.
 */
export function resolveDesignRefPath(figmaDir, mode = "desktop") {
  const dir = figmaDir || "";
  const m = String(mode || "desktop").toLowerCase();
  const candidates = [
    path.join(dir, `figma.${m}.png`),
    path.join(dir, "figma.png"),
    path.join(dir, "figma.desktop.png"),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return "";
}

/**
 * Compute pixel diff between render and design at one breakpoint.
 * Writes diff-<mode>.png to outDir and returns score + metadata.
 */
export async function computeDiffAtBreakpoint({
  renderPath,
  designPath,
  mode,
  outDir,
  threshold = DEFAULT_THRESHOLD,
  includeAA = true,
}) {
  if (!fs.existsSync(renderPath) || !fs.existsSync(designPath)) {
    return {
      score: 0,
      diffRatio: 1,
      error: "Missing render or design image",
      offenderRects: [],
    };
  }

  let PNG;
  let pixelmatch;
  try {
    const deps = await loadCompareDeps();
    PNG = deps.PNG;
    pixelmatch = deps.pixelmatch;
  } catch (e) {
    return {
      score: 0,
      diffRatio: 1,
      error: String(e?.message || e),
      offenderRects: [],
    };
  }

  const renderPng = PNG.sync.read(fs.readFileSync(renderPath));
  const designPng = PNG.sync.read(fs.readFileSync(designPath));

  const aligned = findBestAlignment(renderPng, designPng, {
    threshold,
    includeAA,
    pixelmatch,
    searchPx: 12,
    searchStep: 2,
    searchScale: 0.5,
  });

  const totalPixels = Math.max(1, (aligned?.compared?.width || 0) * (aligned?.compared?.height || 0));
  const diffPixels = Number(aligned?.diffPixels ?? 0);
  const diffRatio = Number(aligned?.diffRatio ?? diffPixels / totalPixels);
  const score = Math.max(0, 1 - diffRatio);

  fs.mkdirSync(outDir, { recursive: true });
  const diffFilename = `diff-${String(mode || "desktop").toLowerCase()}.png`;
  const diffPath = path.join(outDir, diffFilename);
  if (aligned?.diffPng) {
    fs.writeFileSync(diffPath, PNG.sync.write(aligned.diffPng));
  }

  return {
    score,
    diffRatio,
    diffPixels,
    totalPixels,
    compared: aligned?.compared || { width: 0, height: 0 },
    alignment: { dx: aligned?.bestDx ?? 0, dy: aligned?.bestDy ?? 0 },
    diffPath: aligned?.diffPng ? diffPath : null,
    offenderRects: [], // filled by cluster.js when layout is available
  };
}
