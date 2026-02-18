import { PNG } from "pngjs";

function clamp01(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function downsamplePngNearest(src, scale = 0.5) {
  const s = Math.max(0.1, Math.min(1, Number(scale || 0.5)));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx0 = Math.floor(x / s);
      const sy0 = Math.floor(y / s);
      const sx1 = Math.min(src.width, Math.max(sx0 + 1, Math.ceil((x + 1) / s)));
      const sy1 = Math.min(src.height, Math.max(sy0 + 1, Math.ceil((y + 1) / s)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let c = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const sidx = (src.width * sy + sx) << 2;
          r += src.data[sidx + 0];
          g += src.data[sidx + 1];
          b += src.data[sidx + 2];
          a += src.data[sidx + 3];
          c += 1;
        }
      }
      const denom = Math.max(1, c);
      const didx = (w * y + x) << 2;
      out.data[didx + 0] = Math.round(r / denom);
      out.data[didx + 1] = Math.round(g / denom);
      out.data[didx + 2] = Math.round(b / denom);
      out.data[didx + 3] = Math.round(a / denom);
    }
  }
  return out;
}

function diffAtShift({ figmaPng, renderPng, dx, dy, threshold, includeAA, pixelmatch, returnDiff = false }) {
  const figX = Math.max(0, dx);
  const figY = Math.max(0, dy);
  const renderX = Math.max(0, -dx);
  const renderY = Math.max(0, -dy);
  const w = Math.min(figmaPng.width - figX, renderPng.width - renderX);
  const h = Math.min(figmaPng.height - figY, renderPng.height - renderY);
  if (w <= 0 || h <= 0) {
    return { w: 0, h: 0, diffPixels: Number.MAX_SAFE_INTEGER, diffRatio: 1, diffPng: null };
  }
  const figCrop = new PNG({ width: w, height: h });
  const renderCrop = new PNG({ width: w, height: h });
  PNG.bitblt(figmaPng, figCrop, figX, figY, w, h, 0, 0);
  PNG.bitblt(renderPng, renderCrop, renderX, renderY, w, h, 0, 0);
  const diff = new PNG({ width: w, height: h });
  const diffPixels = Number(
    pixelmatch(figCrop.data, renderCrop.data, diff.data, w, h, {
      threshold,
      includeAA,
    }) || 0
  );
  const totalPixels = Math.max(1, w * h);
  return {
    w,
    h,
    diffPixels,
    diffRatio: diffPixels / totalPixels,
    diffPng: returnDiff ? diff : null,
  };
}

export function findBestAlignment(renderImg, figmaImg, options = {}) {
  const threshold = Number(options?.threshold ?? 0.1);
  const includeAA = options?.includeAA !== false;
  const pixelmatch = options?.pixelmatch;
  if (typeof pixelmatch !== "function") {
    throw new Error("findBestAlignment requires options.pixelmatch function");
  }
  const searchPx = Math.max(
    0,
    Math.min(24, Number(options?.searchRadiusPx ?? options?.searchPx ?? 16))
  );
  const searchStep = Math.max(1, Math.min(4, Number(options?.searchStep ?? 1)));
  const searchScale = clamp01(options?.downscale ?? options?.searchScale ?? 0.5) || 0.5;

  const figSmall = downsamplePngNearest(figmaImg, searchScale);
  const renderSmall = downsamplePngNearest(renderImg, searchScale);
  const scaledRange = Math.max(1, Math.round(searchPx * searchScale));
  const scaledStep = Math.max(1, Math.round(searchStep * searchScale));

  let best = null;
  for (let dy = -scaledRange; dy <= scaledRange; dy += scaledStep) {
    for (let dx = -scaledRange; dx <= scaledRange; dx += scaledStep) {
      const probe = diffAtShift({
        figmaPng: figSmall,
        renderPng: renderSmall,
        dx,
        dy,
        threshold,
        includeAA,
        pixelmatch,
      });
      if (!best || probe.diffPixels < best.diffPixels) {
        best = { dx, dy, probe };
      }
    }
  }
  const bestDx = Math.round((best?.dx || 0) / searchScale);
  const bestDy = Math.round((best?.dy || 0) / searchScale);
  const fullCandidates = [
    { dx: 0, dy: 0 },
    { dx: bestDx, dy: bestDy },
    { dx: bestDx + 1, dy: bestDy },
    { dx: bestDx - 1, dy: bestDy },
    { dx: bestDx, dy: bestDy + 1 },
    { dx: bestDx, dy: bestDy - 1 },
  ];
  let full = null;
  let fullBest = { dx: 0, dy: 0 };
  for (const cand of fullCandidates) {
    const out = diffAtShift({
      figmaPng: figmaImg,
      renderPng: renderImg,
      dx: cand.dx,
      dy: cand.dy,
      threshold,
      includeAA,
      pixelmatch,
      returnDiff: true,
    });
    if (!full || out.diffPixels < full.diffPixels) {
      full = out;
      fullBest = { dx: cand.dx, dy: cand.dy };
    }
  }
  return {
    bestDx: fullBest.dx,
    bestDy: fullBest.dy,
    diffPixels: full.diffPixels,
    diffRatio: full.diffRatio,
    compared: { width: full.w, height: full.h },
    diffPng: full.diffPng,
    alignmentSearched: true,
    searchRadiusPx: searchPx,
    alignmentDownscale: searchScale,
    alignmentDiffRatio: Number(best?.probe?.diffRatio ?? full.diffRatio),
  };
}

export function computeLayoutDiff(renderImg, figmaImg, dx, dy, options = {}) {
  const threshold = Number(options?.threshold ?? 0.1);
  const includeAA = options?.includeAA !== false;
  const pixelmatch = options?.pixelmatch;
  if (typeof pixelmatch !== "function") {
    throw new Error("computeLayoutDiff requires options.pixelmatch function");
  }
  const layoutScale = clamp01(options?.layoutDownscale ?? options?.layoutScale ?? 0.35) || 0.35;
  const blurRadius = Math.max(0, Number(options?.blurRadius ?? options?.layoutBlurRadius ?? 0));
  const figSmall = downsamplePngNearest(figmaImg, layoutScale);
  const renderSmall = downsamplePngNearest(renderImg, layoutScale);
  const scaledDx = Math.round(Number(dx || 0) * layoutScale);
  const scaledDy = Math.round(Number(dy || 0) * layoutScale);
  const out = diffAtShift({
    figmaPng: figSmall,
    renderPng: renderSmall,
    dx: scaledDx,
    dy: scaledDy,
    threshold,
    includeAA,
    pixelmatch,
  });
  return {
    layoutDiffPixels: Number(out.diffPixels || 0),
    layoutDiffRatio: Number(out.diffRatio || 1),
    layoutDownscale: layoutScale,
    layoutBlurRadius: blurRadius,
  };
}

export function classifyFailure(compareResult = {}) {
  const dx = Math.abs(Number(compareResult?.bestDx || 0));
  const dy = Math.abs(Number(compareResult?.bestDy || 0));
  const diffRatio = Number(compareResult?.diffRatio ?? 1);
  const layoutDiffRatio = Number(compareResult?.layoutDiffRatio ?? diffRatio);
  const conflictingWidthCount = Number(compareResult?.layoutScore?.conflictingWidthCount || 0);
  const overflowXCount = Number(compareResult?.layoutScore?.overflowXCount || 0);
  const wrongLayoutModel = Boolean(compareResult?.wrongLayoutModel);
  const signals = {
    absBestDx: dx,
    absBestDy: dy,
    diffRatio,
    layoutDiffRatio,
    conflictingWidthCount,
    overflowXCount,
    wrongLayoutModel,
  };

  if (dx > 6 || dy > 6) return { failureMode: "offsetDominated", failureSignals: signals };
  if (Number.isFinite(layoutDiffRatio) && Number.isFinite(diffRatio) && layoutDiffRatio < diffRatio * 0.5) {
    return { failureMode: "aaDominated", failureSignals: signals };
  }
  if (conflictingWidthCount > 0 || overflowXCount > 0) {
    return { failureMode: "constraintConflict", failureSignals: signals };
  }
  if (wrongLayoutModel) return { failureMode: "likelyWrongLayoutModel", failureSignals: signals };
  return { failureMode: "none", failureSignals: signals };
}

export function estimateWrongLayoutModel({ offenders = [], layout = [] } = {}) {
  const rows = Array.isArray(layout) ? layout : [];
  const byId = new Map(rows.map((r) => [String(r?.nodeId || ""), r]));
  const group = new Map();
  for (const offender of Array.isArray(offenders) ? offenders : []) {
    const node = byId.get(String(offender?.nodeId || ""));
    const parentId = String(node?.parentNodeId || "");
    if (!parentId) continue;
    if (!group.has(parentId)) group.set(parentId, []);
    group.get(parentId).push(node);
  }
  let best = null;
  for (const [parentId, nodes] of group.entries()) {
    if (!best || nodes.length > best.count) best = { parentId, count: nodes.length, nodes };
  }
  if (!best || best.count < 3) return false;
  const parent = byId.get(best.parentId);
  if (!parent) return false;
  const tokens = String(parent.className || "").split(/\s+/g).filter(Boolean);
  const isCol = tokens.some((t) => String(t).split(":").pop() === "flex-col");
  const isRow = tokens.some((t) => String(t).split(":").pop() === "flex-row");
  const centers = best.nodes
    .filter((n) => n?.bbox)
    .map((n) => ({
      x: Number(n.bbox.x || 0) + Number(n.bbox.w || 0) / 2,
      y: Number(n.bbox.y || 0) + Number(n.bbox.h || 0) / 2,
    }));
  if (centers.length < 3) return false;
  const xs = centers.map((c) => c.x);
  const ys = centers.map((c) => c.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  if (isCol && spreadX > spreadY * 1.4) return true;
  if (isRow && spreadY > spreadX * 1.4) return true;
  return false;
}

