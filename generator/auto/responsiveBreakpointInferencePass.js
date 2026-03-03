// generator/auto/responsiveBreakpointInferencePass.js
//
// Deterministic responsive inference when only desktop geometry exists.
// Attaches a structured __responsivePlan to nodes/children; rendering can
// later translate this plan into Tailwind breakpoint classes.

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

function roundPx(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function normalizeCols(cols) {
  const n = Math.max(1, Math.min(6, roundPx(cols)));
  return n;
}

function upsertPlan(node, patch) {
  if (!node || typeof node !== "object" || !patch || typeof patch !== "object") return;
  const curr = node.__responsivePlan && typeof node.__responsivePlan === "object" ? node.__responsivePlan : {};
  node.__responsivePlan = {
    ...curr,
    ...patch,
    layout: { ...(curr.layout || {}), ...(patch.layout || {}) },
    width: { ...(curr.width || {}), ...(patch.width || {}) },
    spacing: { ...(curr.spacing || {}), ...(patch.spacing || {}) },
    typography: { ...(curr.typography || {}), ...(patch.typography || {}) },
  };
}

function inferGridBreakpoints(node) {
  const hints = node?.__layoutHints || {};
  const colsDesktop = normalizeCols(
    Number(hints.colCount || 0) >= 2
      ? Number(hints.colCount)
      : Number(hints.colsHint || 0)
  );
  if (colsDesktop < 3) return;
  upsertPlan(node, {
    layout: {
      gridCols: {
        base: 1,
        md: 2,
        lg: colsDesktop,
        source: "desktop-grid>=3",
      },
    },
  });
}

function inferTwoColumnStack(node) {
  const kids = asArr(node?.children);
  if (kids.length !== 2) return;
  const axis = String(node?.__layoutHints?.axis || "").toLowerCase();
  if (axis !== "horizontal") return;

  const parent = nodeBox(node);
  const left = nodeBox(kids[0]);
  const right = nodeBox(kids[1]);
  if (!parent || !left || !right || parent.w <= 0) return;

  const r1 = left.w / parent.w;
  const r2 = right.w / parent.w;
  const nearHalf = Math.abs(r1 - 0.5) <= 0.15 && Math.abs(r2 - 0.5) <= 0.15;
  const similar = Math.abs(r1 - r2) <= 0.12;
  if (!nearHalf || !similar) return;

  upsertPlan(node, {
    layout: {
      flexDirection: {
        base: "col",
        md: "row",
        source: "two-col-half-split",
      },
    },
  });

  for (const child of kids) {
    upsertPlan(child, {
      width: {
        base: "full",
        md: "1/2",
        source: "two-col-half-split",
      },
    });
  }
}

function inferPaddingReduction(node) {
  const al = node?.auto || {};
  const padL = asNum(al.padL);
  const padR = asNum(al.padR);
  const largeL = padL !== null && padL > 48;
  const largeR = padR !== null && padR > 48;
  if (!largeL && !largeR) return;

  upsertPlan(node, {
    spacing: {
      paddingX: {
        basePx: 20,
        lgLeftPx: largeL ? roundPx(padL) : 0,
        lgRightPx: largeR ? roundPx(padR) : 0,
        source: "large-side-padding",
      },
    },
  });
}

function isHeadingLike(node, semantics) {
  const id = String(node?.id || "");
  const semTag = String(semantics?.[id]?.tag || "").toLowerCase();
  if (/^h[1-6]$/.test(semTag)) return true;

  const name = String(node?.name || "").toLowerCase();
  const key = String(node?.key || "").toLowerCase();
  if (/\b(heading|headline|title|hero)\b/.test(`${name} ${key}`)) return true;

  const raw = String(node?.text?.raw || "").trim();
  const size = asNum(node?.typography?.sizePx) ?? asNum(node?.text?.fontSize) ?? 0;
  const weight = asNum(node?.typography?.weight) ?? asNum(node?.text?.fontWeight) ?? 0;
  return raw.length > 0 && raw.length <= 120 && size >= 36 && weight >= 600;
}

function inferHeadingScaling(node, semantics) {
  if (!node?.text) return;
  if (!isHeadingLike(node, semantics)) return;

  const size = asNum(node?.typography?.sizePx) ?? asNum(node?.text?.fontSize);
  if (size === null || size < 36) return;

  const base = Math.max(24, Math.round(size * 0.8));
  if (base >= size) return;
  upsertPlan(node, {
    typography: {
      headingScale: {
        basePx: base,
        mdPx: roundPx(size),
        thresholdPx: 36,
        source: "large-heading-scale",
      },
    },
  });
}

function annotateNode(node, semantics) {
  if (!node || typeof node !== "object") return;
  inferGridBreakpoints(node);
  inferTwoColumnStack(node);
  inferPaddingReduction(node);
  inferHeadingScaling(node, semantics);
}

function walk(node, semantics, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  annotateNode(node, semantics);
  for (const child of asArr(node.children)) {
    walk(child, semantics, seen);
  }
}

export function responsiveBreakpointInferencePass(ast) {
  if (!ast || typeof ast !== "object" || !ast.tree || typeof ast.tree !== "object") return ast;
  const semantics = ast?.semantics || ast?.semanticsMap || ast?.meta?.semantics || {};
  walk(ast.tree, semantics);
  return ast;
}

export default responsiveBreakpointInferencePass;
