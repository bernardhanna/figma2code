// generator/auto/layoutIntentV2Pass.js
//
// Deterministic geometric layout hints for non-auto-layout groups.
// This pass annotates nodes with:
// - __layoutHints (geometry observations)
// - __layoutPriors (raw Figma layout flags)
// - __layoutModel (final normalized intent consumed by codegen)

import { buildLayoutModelForNode } from "./layoutModel.js";

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nodeBox(node) {
  if (!node || typeof node !== "object") return null;
  const bb = node.bb || node.bbox || null;
  if (bb) {
    const x = asNum(bb.x);
    const y = asNum(bb.y);
    const w = asNum(bb.w);
    const h = asNum(bb.h);
    if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const x = asNum(node.x);
  const y = asNum(node.y);
  const w = asNum(node.w);
  const h = asNum(node.h);
  if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) {
    return { x, y, w, h };
  }
  return null;
}

function median(values) {
  const arr = asArr(values).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const m = Math.floor(arr.length / 2);
  if (arr.length % 2) return arr[m];
  return (arr[m - 1] + arr[m]) / 2;
}

function inferAxisAndSpacing(children) {
  const boxes = children.map(nodeBox).filter(Boolean);
  if (boxes.length < 2) return null;

  const centers = boxes.map((b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 }));
  const xs = centers.map((c) => c.cx);
  const ys = centers.map((c) => c.cy);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const horizontal = spreadX > spreadY * 1.2;

  const sorted = boxes
    .map((b, i) => ({
      i,
      lead: horizontal ? b.x : b.y,
      tail: horizontal ? b.x + b.w : b.y + b.h,
    }))
    .sort((a, b) => a.lead - b.lead);

  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(Math.max(0, sorted[i].lead - sorted[i - 1].tail));
  }

  const spacing = Math.max(0, median(gaps));
  const axis = horizontal ? "horizontal" : "vertical";
  const confidence =
    Math.max(spreadX, spreadY) > 0
      ? Math.min(1, Math.max(spreadX, spreadY) / (Math.max(spreadX, spreadY) + Math.min(spreadX, spreadY) + 1))
      : 0;

  return { axis, spacing, confidence, spreadX, spreadY };
}

function inferRowsByYBand(children) {
  const indexed = children
    .map((node, i) => ({ i, box: nodeBox(node) }))
    .filter((x) => x.box);
  if (indexed.length < 2) return null;

  const heights = indexed.map((x) => x.box.h).filter((v) => Number.isFinite(v) && v > 0);
  const baseTol = Math.max(6, Math.round(median(heights) * 0.35));

  const sorted = indexed
    .map((x) => ({
      i: x.i,
      x: x.box.x,
      y: x.box.y,
      w: x.box.w,
      h: x.box.h,
      cx: x.box.x + x.box.w / 2,
      cy: x.box.y + x.box.h / 2,
      right: x.box.x + x.box.w,
      bottom: x.box.y + x.box.h,
    }))
    .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));

  const rows = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(item.cy - r.anchorCy) <= baseTol);
    if (!row) {
      rows.push({ anchorCy: item.cy, items: [item] });
      continue;
    }
    row.items.push(item);
    row.anchorCy = median(row.items.map((x) => x.cy));
  }

  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  rows.sort((a, b) => (Math.min(...a.items.map((x) => x.y)) - Math.min(...b.items.map((x) => x.y))));
  return { rows, tolerancePx: baseTol };
}

function inferCollection(children) {
  const boxes = children.map(nodeBox).filter(Boolean);
  if (boxes.length < 3) return null;
  const widths = boxes.map((b) => b.w);
  const heights = boxes.map((b) => b.h);
  const wMin = Math.min(...widths);
  const wMax = Math.max(...widths);
  const hMin = Math.min(...heights);
  const hMax = Math.max(...heights);
  if (wMin <= 0 || hMin <= 0) return null;
  const nearEqual = wMax / wMin <= 1.15 && hMax / hMin <= 1.2;
  if (!nearEqual) return null;
  const colsHint = Math.max(2, Math.min(4, boxes.length));
  return { collectionLike: true, colsHint };
}

function inferCollectionFromRows(children) {
  const grouped = inferRowsByYBand(children);
  if (!grouped || !grouped.rows || grouped.rows.length < 2) return null;

  const rowLens = grouped.rows.map((r) => r.items.length).filter((n) => n > 0);
  const colCount = Math.max(...rowLens, 0);
  if (colCount < 2) return null;

  const rowCount = grouped.rows.length;
  const minRow = Math.min(...rowLens);
  const maxRow = Math.max(...rowLens);
  const regularity = maxRow > 0 ? minRow / maxRow : 0;
  if (regularity < 0.6) return null;

  // Build column tracks from row-wise x positions (aligned x detection).
  const allItems = grouped.rows.flatMap((r) => r.items);
  const medianW = median(allItems.map((x) => x.w));
  const xTol = Math.max(8, Math.round(medianW * 0.2));
  const tracks = [];
  for (const item of allItems.sort((a, b) => a.x - b.x)) {
    const hit = tracks.find((t) => Math.abs(item.x - t.anchorX) <= xTol);
    if (!hit) {
      tracks.push({ anchorX: item.x, items: [item] });
      continue;
    }
    hit.items.push(item);
    hit.anchorX = median(hit.items.map((x) => x.x));
  }
  tracks.sort((a, b) => a.anchorX - b.anchorX);

  const alignedTrackCount = tracks.filter((t) => t.items.length >= Math.max(2, Math.floor(rowCount * 0.6))).length;
  const alignedColumns = alignedTrackCount >= 2;

  // Repeated width consistency for card-like columns.
  const widths = allItems.map((x) => x.w).filter((n) => Number.isFinite(n) && n > 0);
  const wMin = widths.length ? Math.min(...widths) : 0;
  const wMax = widths.length ? Math.max(...widths) : 0;
  const widthRepeatScore = wMin > 0 ? Math.max(0, Math.min(1, 1 - (wMax - wMin) / wMin)) : 0;
  const repeatedWidths = widthRepeatScore >= 0.7;

  const colGaps = [];
  grouped.rows.forEach((r) => {
    for (let i = 1; i < r.items.length; i += 1) {
      colGaps.push(Math.max(0, r.items[i].x - r.items[i - 1].right));
    }
  });

  const rowGaps = [];
  for (let i = 1; i < grouped.rows.length; i += 1) {
    const prevBottom = Math.max(...grouped.rows[i - 1].items.map((x) => x.bottom));
    const nextTop = Math.min(...grouped.rows[i].items.map((x) => x.y));
    rowGaps.push(Math.max(0, nextTop - prevBottom));
  }

  return {
    collectionLike: true,
    colsHint: Math.max(2, Math.min(6, colCount)),
    rowCount,
    colCount,
    alignedColumns,
    alignedTrackCount,
    repeatedWidths,
    widthRepeatScore,
    gridCandidate: alignedColumns && repeatedWidths && regularity >= 0.7 && rowCount >= 2 && colCount >= 2,
    rowGapPx: Math.max(0, median(rowGaps)),
    colGapPx: Math.max(0, median(colGaps)),
    rowBandTolerancePx: grouped.tolerancePx,
    regularity,
  };
}

function modeInt(values) {
  const counts = new Map();
  for (const raw of asArr(values)) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [n, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && n > best)) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

function bucketByTolerance(value, tolerance) {
  const t = Math.max(1, Number(tolerance) || 1);
  return Math.round(Number(value) / t) * t;
}

function overlapArea(a, b) {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return ix * iy;
}

function inferGridFromGeometry(children) {
  const grouped = inferRowsByYBand(children);
  if (!grouped || !grouped.rows || grouped.rows.length < 1) return null;
  const rows = grouped.rows.map((r) => ({ ...r, items: asArr(r.items).slice().sort((a, b) => a.x - b.x) }));
  const allItems = rows.flatMap((r) => r.items);
  if (allItems.length < 3) return null;

  const widths = allItems.map((i) => i.w).filter((n) => Number.isFinite(n) && n > 0);
  const heights = allItems.map((i) => i.h).filter((n) => Number.isFinite(n) && n > 0);
  if (!widths.length || !heights.length) return null;
  const widthMedian = median(widths);
  const widthRatio = Math.max(...widths) / Math.max(1, Math.min(...widths));

  // Guardrail: reject likely masonry/tag-cloud sets.
  if (widthRatio > 1.22) return null;

  // Guardrail: reject overlap-heavy sets.
  let overlapPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < allItems.length; i += 1) {
    for (let j = i + 1; j < allItems.length; j += 1) {
      totalPairs += 1;
      const a = allItems[i];
      const b = allItems[j];
      const area = overlapArea(a, b);
      if (area <= 0) continue;
      const minArea = Math.min(a.w * a.h, b.w * b.h);
      if (minArea > 0 && area / minArea > 0.12) overlapPairs += 1;
    }
  }
  const overlapRatio = totalPairs > 0 ? overlapPairs / totalPairs : 0;
  if (overlapRatio > 0.18) return null;

  const rowLens = rows.map((r) => r.items.length).filter((n) => n > 0);
  if (!rowLens.length) return null;

  const rowCount = rows.length;
  const modeCols = modeInt(rowLens);
  const maxStableCols = Math.max(...rowLens);
  const cols = Math.max(1, modeCols || maxStableCols);
  if (cols < 2) return null;

  // Validate base shape: either multiple rows or at least 3 clear columns.
  if (!(rowCount >= 2 || cols >= 3)) return null;

  const xTol = Math.max(8, Math.round(Math.max(widthMedian * 0.2, 6)));
  const colBuckets = new Map();
  for (const row of rows) {
    for (const item of row.items) {
      const key = bucketByTolerance(item.x, xTol);
      if (!colBuckets.has(key)) colBuckets.set(key, []);
      colBuckets.get(key).push(item.x);
    }
  }
  const canonicalColumns = [...colBuckets.entries()]
    .map(([key, xs]) => ({ key: Number(key), x: median(xs), hits: xs.length }))
    .sort((a, b) => a.x - b.x);

  if (canonicalColumns.length < 2) return null;

  let aligned = 0;
  let total = 0;
  const xResiduals = [];
  for (const row of rows) {
    for (const item of row.items) {
      total += 1;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const col of canonicalColumns) {
        const d = Math.abs(item.x - col.x);
        if (d < bestDist) bestDist = d;
      }
      if (bestDist <= xTol) aligned += 1;
      if (Number.isFinite(bestDist)) xResiduals.push(bestDist);
    }
  }
  const xAlignment = total > 0 ? aligned / total : 0;
  if (xAlignment < 0.85) return null;

  const canonicalXs = canonicalColumns.map((c) => c.x);
  const canonicalGaps = [];
  for (let i = 1; i < canonicalXs.length; i += 1) {
    canonicalGaps.push(Math.max(0, canonicalXs[i] - canonicalXs[i - 1]));
  }
  const rowGaps = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prevBottom = Math.max(...rows[i - 1].items.map((x) => x.bottom));
    const nextTop = Math.min(...rows[i].items.map((x) => x.y));
    rowGaps.push(Math.max(0, nextTop - prevBottom));
  }

  const gapX = Math.max(0, median(canonicalGaps));
  const gapY = Math.max(0, median(rowGaps));

  // Conservative 2-col behavior: only upgrade when geometry is very stable.
  if (cols === 2) {
    const twoByTwoStrong =
      rowCount >= 2 &&
      rowLens.every((n) => n === 2) &&
      xAlignment >= 0.95 &&
      widthRatio <= 1.05 &&
      median(xResiduals) <= Math.max(4, Math.round(widthMedian * 0.08));
    const veryStable =
      (rowCount >= 3 &&
        xAlignment >= 0.93 &&
        widthRatio <= 1.08 &&
        median(xResiduals) <= Math.max(6, Math.round(widthMedian * 0.12))) ||
      twoByTwoStrong;
    if (!veryStable) return null;
  }

  return {
    collectionLike: true,
    layoutType: "grid",
    metadata: {
      cols,
      gapX,
      gapY,
    },
    layoutMetadata: {
      cols,
      gapX,
      gapY,
    },
    gridCandidate: true,
    colsHint: cols,
    rowCount,
    colCount: cols,
    rowGapPx: gapY,
    colGapPx: gapX,
    rowBandTolerancePx: grouped.tolerancePx,
    widthRepeatScore: Math.max(0, Math.min(1, 1 - (widthRatio - 1))),
    repeatedWidths: widthRatio <= 1.15,
    alignedColumns: true,
    alignedTrackCount: canonicalColumns.length,
    regularity: rowLens.length ? Math.min(...rowLens) / Math.max(...rowLens) : 0,
    overlapRatio,
    xAlignment,
  };
}

function annotateNode(node, opts = {}) {
  const kids = asArr(node?.children);
  if (kids.length) {
    const inferred = inferAxisAndSpacing(kids);
    if (inferred) {
      const gridFromGeometry = inferGridFromGeometry(kids);
      const collectionRows = inferCollectionFromRows(kids);
      const collectionClassic = inferCollection(kids);
      const collection = gridFromGeometry || collectionRows || collectionClassic;
      const lowConfidence =
        inferred.confidence < 0.55 &&
        kids.length >= 3 &&
        inferred.spreadX > 0 &&
        inferred.spreadY > 0 &&
        !(collection && collection.collectionLike);
      node.__layoutHints = {
        axis: inferred.axis,
        spacingPx: inferred.spacing,
        confidence: inferred.confidence,
        lowConfidence,
        fallbackRecommended: lowConfidence,
        spreadX: inferred.spreadX,
        spreadY: inferred.spreadY,
        ...(collection || {
          collectionLike: false,
          colsHint: 0,
          layoutType: "flex",
          layoutMetadata: null,
          rowCount: 0,
          colCount: 0,
          alignedColumns: false,
          alignedTrackCount: 0,
          repeatedWidths: false,
          widthRepeatScore: 0,
          gridCandidate: false,
          rowGapPx: 0,
          colGapPx: 0,
          rowBandTolerancePx: 0,
          regularity: 0,
        }),
      };
    }
    // Figma Layout guide "Grid Npx": prefer CSS grid and use N for gap
    const layoutGuide = node.layoutGuide;
    if (
      layoutGuide &&
      layoutGuide.pattern === "GRID" &&
      typeof layoutGuide.sectionSize === "number" &&
      layoutGuide.sectionSize > 0
    ) {
      if (!node.__layoutHints) node.__layoutHints = {};
      node.__layoutHints.layoutGuideGrid = true;
      node.__layoutHints.layoutGuideGapPx = layoutGuide.sectionSize;
    }
  }
  const model = buildLayoutModelForNode(node, { isRoot: !!opts.isRoot });
  node.__layoutPriors = model.priors;
  node.__layoutModel = model;
}

function walk(node, seen = new Set(), isRoot = false) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  annotateNode(node, { isRoot });
  for (const child of asArr(node.children)) walk(child, seen, false);
}

export function layoutIntentV2Pass(ast) {
  if (!ast || typeof ast !== "object") return ast;
  if (!ast.tree || typeof ast.tree !== "object") return ast;
  walk(ast.tree, new Set(), true);
  return ast;
}

export default layoutIntentV2Pass;

