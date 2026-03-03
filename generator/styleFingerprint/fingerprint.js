// generator/styleFingerprint/fingerprint.js
import { STYLE_FP_THRESHOLDS as T } from "./constants.js";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lower(v) {
  return String(v || "").toLowerCase();
}

function boxOf(node) {
  if (!node || typeof node !== "object") return null;
  const bb = node.bb || node.bbox || null;
  if (bb) {
    const w = toNum(bb.w);
    const h = toNum(bb.h);
    const x = toNum(bb.x);
    const y = toNum(bb.y);
    if (w && h && x !== null && y !== null && w > 0 && h > 0) return { x, y, w, h };
  }
  const w = toNum(node.w);
  const h = toNum(node.h);
  const x = toNum(node.x) ?? 0;
  const y = toNum(node.y) ?? 0;
  if (w && h && w > 0 && h > 0) return { x, y, w, h };
  return null;
}

function area(b) {
  return b && b.w > 0 && b.h > 0 ? b.w * b.h : 0;
}

function unionBox(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  let minX = valid[0].x;
  let minY = valid[0].y;
  let maxX = valid[0].x + valid[0].w;
  let maxY = valid[0].y + valid[0].h;
  for (const b of valid.slice(1)) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function fillsOf(node) {
  if (Array.isArray(node?.fills)) return node.fills;
  if (Array.isArray(node?.fill)) return node.fill;
  return [];
}

function alphaOf(fill) {
  return toNum(fill?.a ?? fill?.opacity ?? fill?.alpha ?? 1) ?? 1;
}

function backgroundInfo(node) {
  const fills = fillsOf(node);
  let maxAlpha = 0;
  let hasSolid = false;
  let hasGradient = false;
  for (const f of fills) {
    const kind = lower(f?.kind || f?.type || f?.fillType);
    const alpha = alphaOf(f);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (kind.includes("solid")) hasSolid = true;
    if (kind.includes("gradient")) hasGradient = true;
  }
  const hasBackgroundFill = (hasSolid || hasGradient) && maxAlpha >= 0.01;
  const backgroundFillType = hasSolid ? "solid" : hasGradient ? "gradient" : "none";
  return {
    hasBackgroundFill,
    backgroundFillType,
    bgOpacity: maxAlpha,
  };
}

function strokeInfo(node) {
  const weight =
    toNum(node?.stroke?.weight) ??
    toNum(node?.strokeWeight) ??
    toNum(node?.strokes?.[0]?.weight) ??
    0;
  const hasStroke = weight > 0;
  return { hasStroke, strokeWidth: hasStroke ? weight : 0 };
}

function cornerInfo(node, sizeBox) {
  const trbl = Array.isArray(node?.cornerRadii) ? node.cornerRadii.map((v) => toNum(v) ?? 0) : null;
  const uniform =
    toNum(node?.cornerRadius) ??
    toNum(node?.r) ??
    toNum(node?.radius) ??
    null;
  const cornerRadius = trbl
    ? { tl: trbl[0] || 0, tr: trbl[1] || 0, br: trbl[2] || 0, bl: trbl[3] || 0 }
    : uniform ?? 0;
  const maxR = trbl ? Math.max(...trbl) : uniform ?? 0;
  const minDim = Math.min(sizeBox?.w || 0, sizeBox?.h || 0);
  const isPillRadius = minDim > 0 && maxR >= minDim / 2 - T.PILL_TOLERANCE_PX;
  return { cornerRadius, isPillRadius };
}

function isIconLike(node) {
  const type = String(node?.type || "").toUpperCase();
  if (node?.img?.src) return true;
  if (type === "SVG" || type === "VECTOR" || type === "ELLIPSE" || type === "BOOLEAN_OPERATION") return true;
  const n = lower(node?.name);
  const k = lower(node?.key);
  return /\b(icon|arrow|chevron|caret|glyph|vector|logo)\b/.test(n) || /\b(icon|arrow|chevron|caret|glyph|vector|logo)\b/.test(k);
}

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function textNodes(node) {
  const out = [];
  walk(node, (n) => {
    if (typeof n?.text?.raw === "string" && n.text.raw.trim()) out.push(n);
  });
  return out;
}

function childComposition(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  const texts = textNodes(node);
  const hasText = texts.length > 0;
  let hasIcon = false;
  walk(node, (n) => {
    if (n === node) return;
    if (isIconLike(n)) hasIcon = true;
  });
  const childCount = kids.length;
  const isTextOnly = hasText && !hasIcon;
  const isTextPlusIcon = hasText && hasIcon;
  return { hasText, hasIcon, childCount, isTextOnly, isTextPlusIcon, textNodes: texts };
}

function typographyInfo(textNodesList) {
  const t = textNodesList[0];
  if (!t) {
    return {
      fontSize: null,
      fontWeight: null,
      letterSpacing: null,
      textDecoration: null,
      lineHeight: null,
      textColor: null,
    };
  }
  const text = t.text || {};
  const typo = t.typography || {};
  return {
    fontSize: toNum(typo.sizePx) ?? toNum(text.fontSize),
    fontWeight: toNum(typo.weight) ?? toNum(text.fontWeight),
    letterSpacing: toNum(typo.letterSpacingPx) ?? toNum(text.letterSpacingPx),
    textDecoration: String(typo.decoration || text.decoration || "").toLowerCase() || null,
    lineHeight: toNum(typo.lineHeightPx) ?? toNum(text.lineHeightPx),
    textColor:
      (typeof typo.colorHex === "string" && typo.colorHex.trim()) ||
      (typeof text.colorHex === "string" && text.colorHex.trim()) ||
      (typeof text.fillHex === "string" && text.fillHex.trim()) ||
      null,
  };
}

function paddingFromAuto(node) {
  const auto = node?.auto || {};
  const padL = toNum(auto.padL) ?? 0;
  const padR = toNum(auto.padR) ?? 0;
  const padT = toNum(auto.padT) ?? 0;
  const padB = toNum(auto.padB) ?? 0;
  if (padL || padR || padT || padB) {
    return {
      paddingX: (padL + padR) / 2,
      paddingY: (padT + padB) / 2,
      source: "auto",
    };
  }
  return null;
}

function paddingFromGeometry(node, rootBox) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  const union = unionBox(kids.map((k) => boxOf(k)));
  if (!rootBox || !union) return { paddingX: 0, paddingY: 0, source: "none" };
  const padL = Math.max(0, union.x - rootBox.x);
  const padR = Math.max(0, rootBox.x + rootBox.w - (union.x + union.w));
  const padT = Math.max(0, union.y - rootBox.y);
  const padB = Math.max(0, rootBox.y + rootBox.h - (union.y + union.h));
  return { paddingX: (padL + padR) / 2, paddingY: (padT + padB) / 2, source: "geometry", union };
}

export function computeStyleFingerprint(node) {
  if (!node || typeof node !== "object") return null;
  const rootBox = boxOf(node);
  if (!rootBox) return null;

  const bg = backgroundInfo(node);
  const stroke = strokeInfo(node);
  const corner = cornerInfo(node, rootBox);
  const comp = childComposition(node);
  const typo = typographyInfo(comp.textNodes);

  const autoPad = paddingFromAuto(node);
  const geomPad = paddingFromGeometry(node, rootBox);
  const pad = autoPad || geomPad;

  const childUnion = geomPad.union || unionBox((node.children || []).map((c) => boxOf(c)));
  const nodeArea = area(rootBox);
  const childrenArea = area(childUnion);
  const textBox = comp.textNodes.length ? boxOf(comp.textNodes[0]) : null;
  const textArea = area(textBox);

  return {
    hasBackgroundFill: bg.hasBackgroundFill,
    backgroundFillType: bg.backgroundFillType,
    bgOpacity: bg.bgOpacity,
    hasStroke: stroke.hasStroke,
    strokeWidth: stroke.strokeWidth,
    cornerRadius: corner.cornerRadius,
    isPillRadius: corner.isPillRadius,
    paddingX: pad.paddingX,
    paddingY: pad.paddingY,
    childComposition: {
      hasText: comp.hasText,
      hasIcon: comp.hasIcon,
      childCount: comp.childCount,
      isTextOnly: comp.isTextOnly,
      isTextPlusIcon: comp.isTextPlusIcon,
    },
    typography: {
      fontSize: typo.fontSize,
      fontWeight: typo.fontWeight,
      letterSpacing: typo.letterSpacing,
      textDecoration: typo.textDecoration,
      lineHeight: typo.lineHeight,
      textColor: typo.textColor,
    },
    size: {
      w: rootBox.w,
      h: rootBox.h,
      aspectRatio: rootBox.h > 0 ? rootBox.w / rootBox.h : null,
      textAreaRatio: nodeArea > 0 ? textArea / nodeArea : 0,
      paddingRatio: nodeArea > 0 ? Math.max(0, (nodeArea - childrenArea) / nodeArea) : 0,
    },
    meta: {
      nodeId: node.id || null,
      paddingSource: pad.source,
    },
  };
}
