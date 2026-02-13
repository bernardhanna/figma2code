const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/underline/normalizeBars";

const PADDING_ANY = /^p-|^pt-|^pr-|^pb-|^pl-|^px-|^py-/;
const BAR_STRIP = /^(flex|inline-flex|flex-row|flex-col|grid|inline-grid|grid-cols-|block|inline|inline-block|contents|hidden|items-|justify-|self-|gap-|whitespace-nowrap|max-w-|min-w-|w-full|w-screen|h-full|place-)/;
const BORDER_THICK = /^border-\[0\.5rem\]$|^border-b-\[|^border-\[0\.\d+rem\]$/;
const BG_COLOR = /^bg-\[(?:rgba?|#)[^\]]+\]$/;
const BORDER_COLOR = /^border(?:-b)?-\[(?:rgba?|#)[^\]]+\]$/;

const normalizeToken = (token) => String(token || "").split(":").pop();

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent == null) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

/** Width in ~60–140px range or w-[6.25rem] / w-[100px]. */
const hasBarLikeWidth = (tokens, attrs) => {
  const normalized = tokens.map(normalizeToken);
  for (const t of normalized) {
    const pxMatch = t.match(/^w-\[(\d+)px\]$/);
    if (pxMatch) {
      const n = parseInt(pxMatch[1], 10);
      if (n >= 60 && n <= 140) return true;
    }
    const remMatch = t.match(/^w-\[([\d.]+)rem\]$/);
    if (remMatch) {
      const n = parseFloat(remMatch[1]);
      if (n >= 6.2 && n <= 6.3) return true; // 6.25rem ≈ 100px
    }
  }
  const wRem = getAttrValue(attrs, "data-w-rem");
  if (wRem && /^6\.2[0-5]rem$/.test(String(wRem).trim())) return true;
  return false;
};

/** Height in 6–14px range or h-[0.625rem]. */
const hasBarLikeHeight = (tokens) => {
  const normalized = tokens.map(normalizeToken);
  return normalized.some((t) => {
    const pxMatch = t.match(/^h-\[(\d+)px\]$/);
    if (pxMatch) {
      const n = parseInt(pxMatch[1], 10);
      return n >= 6 && n <= 14;
    }
    const remMatch = t.match(/^h-\[([\d.]+)rem\]$/);
    if (remMatch) {
      const n = parseFloat(remMatch[1]);
      return n >= 0.375 && n <= 0.875; // ~6–14px
    }
    return false;
  });
};

/** Border thickness >= 6px or border-* present. */
const hasBarLikeBorder = (tokens) => {
  const normalized = tokens.map(normalizeToken);
  return normalized.some((t) => BORDER_THICK.test(t) || /^border(?:-b)?-\[\d/.test(t));
};

/** Has solid background color. */
const hasBarLikeBg = (tokens) => tokens.some((t) => BG_COLOR.test(normalizeToken(t)));

/** Extract single color from tokens: bg-* or border-* color. */
const extractBarColor = (tokens) => {
  const normalized = tokens.map(normalizeToken);
  const bg = normalized.find((t) => BG_COLOR.test(t));
  if (bg) {
    const m = bg.match(/^bg-\[(.+)\]$/);
    return m ? m[1] : null;
  }
  const borderColor = normalized.find((t) => BORDER_COLOR.test(t));
  if (borderColor) {
    const m = borderColor.match(/^border(?:-b)?-\[(.+)\]$/);
    return m ? m[1] : null;
  }
  return null;
};

const hasBarHint = (node) => {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("underline") || dataKey.includes("bar") || dataKey.includes("accent")) return true;
  const wRem = String(getAttrValue(node.attrs, "data-w-rem") || "").trim();
  const wPx = String(getAttrValue(node.attrs, "data-w-px") || "").trim();
  if (wRem && /^6\.2[0-5]rem$/.test(wRem)) return true;
  if (wPx && /^100(?:\.0+)?px$/.test(wPx)) return true;
  return false;
};

const hasExplicitStrokeHint = (node) => {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("stroke") || dataKey.includes("outline")) return true;
  const dataStroke = String(getAttrValue(node.attrs, "data-stroke") || "").trim();
  if (dataStroke === "1" || dataStroke.toLowerCase() === "true") return true;
  const dataStyle = String(getAttrValue(node.attrs, "data-underline-style") || "").toLowerCase().trim();
  if (dataStyle === "stroke" || dataStyle === "outline") return true;
  return false;
};

const isDecorativeBarGroup = (node, nodes, childrenMap, nodeIndex) => {
  if (!node?.attrs) return false;
  const decorative = getAttrValue(node.attrs, "data-decorative");
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (decorative != null && String(decorative).trim() === "1") return true;
  if (dataKey.includes("decorativebar")) return true;
  const children = childrenMap.get(nodeIndex) || [];
  if (children.length >= 3) {
    const childTokens = children.map((i) => getClassTokens(nodes[i]?.attrs || {}));
    const allSmallBars = childTokens.every((t) => {
      const cores = t.map(normalizeToken);
      const hasBg = cores.some((c) => BG_COLOR.test(c));
      const hasHeight = cores.some((c) => /^h-\[0\.3/.test(c) || /^h-\[0\.25/.test(c) || /^h-\[0\.5/.test(c));
      return hasBg && hasHeight;
    });
    if (allSmallBars) return true;
  }
  return false;
};

const hasDecorativeBarAncestor = (nodes, childrenMap, nodeIndex) => {
  let current = nodes[nodeIndex]?.parentIndex;
  while (current != null) {
    const n = nodes[current];
    if (isDecorativeBarGroup(n, nodes, childrenMap, current)) return true;
    current = n?.parentIndex;
  }
  return false;
};

const getBarWidthToken = (node, tokens) => {
  const wRem = String(getAttrValue(node.attrs, "data-w-rem") || "").trim();
  if (wRem && /^[0-9.]+rem$/.test(wRem)) return `w-[${wRem}]`;
  const wPx = String(getAttrValue(node.attrs, "data-w-px") || "").trim();
  if (wPx && /^[0-9.]+px$/.test(wPx)) return `w-[${wPx}]`;
  return "w-[100px]";
};

/** Already in canonical form: filled always ok; stroke only if explicit hint. */
const isAlreadyCanonicalBar = (node, tokens) => {
  const normalized = tokens.map(normalizeToken);
  const hasH10 = normalized.some((c) => c === "h-[10px]");
  const hasBg = normalized.some((c) => BG_COLOR.test(c));
  const hasBorderB = normalized.some((c) => c === "border-b-[10px]");
  const hasBorderColor = normalized.some((c) => /^border-b-\[/.test(c));
  const hasPadding = normalized.some((c) => PADDING_ANY.test(c));
  const hasBorderOther = normalized.some((c) => /^border(?!-b-\[)/.test(c));
  const hasStrip = normalized.some((c) => BAR_STRIP.test(c));
  const hasWidth = hasBarLikeWidth(tokens, node.attrs);
  const filled = hasWidth && hasH10 && hasBg && !hasPadding && !hasBorderOther && !hasStrip;
  const stroke = hasWidth && hasBorderB && hasBorderColor && !hasPadding && !hasBorderOther && !hasStrip;
  if (filled) return true;
  if (stroke && hasExplicitStrokeHint(node)) return true;
  return false;
};

/** True if node is a bar candidate: div/span, no children, bar-like width + (height or border) + color. */
const isBarCandidate = (node, nodes, childrenMap, nodeIndex) => {
  const tag = (node.tag || "").toLowerCase();
  if (tag !== "div" && tag !== "span") return false;
  if (hasDecorativeBarAncestor(nodes, childrenMap, nodeIndex)) return false;
  const children = childrenMap.get(nodeIndex) || [];
  if (children.length > 0) return false;

  const tokens = getClassTokens(node.attrs || {});
  if (isAlreadyCanonicalBar(node, tokens)) return false;
  const normalized = tokens.map(normalizeToken);
  const widthLike = hasBarLikeWidth(tokens, node.attrs) || hasBarHint(node);
  const hasHeight = hasBarLikeHeight(tokens);
  const hasBorder = hasBarLikeBorder(tokens);
  const hasBg = hasBarLikeBg(tokens);
  if (!hasHeight && !hasBorder && !hasBg) return false;
  if (!widthLike) return false;
  const color = extractBarColor(tokens);
  if (!color) return false;
  return true;
};

/** Build normalized bar classes: remove ALL padding, then set to filled or border-only. */
const buildNormalizedBarClasses = (tokens, extractedColor, widthToken, preferFilled, addMxAuto) => {
  const normalized = tokens.map(normalizeToken);
  const remove = new Set();

  tokens.forEach((t, i) => {
    if (PADDING_ANY.test(normalizeToken(t))) remove.add(t);
    if (/^border/.test(normalized[i])) remove.add(t);
    if (/^h-\[/.test(normalized[i])) remove.add(t);
    if (/^w-\[/.test(normalized[i])) remove.add(t);
    if (BAR_STRIP.test(normalized[i])) remove.add(t);
    if (BG_COLOR.test(normalized[i])) remove.add(t);
  });

  let out = tokens.filter((t) => !remove.has(t));

  if (preferFilled !== false) {
    out.push(widthToken, "h-[10px]", `bg-[${extractedColor}]`);
  } else {
    out.push(widthToken, "h-auto", "border-b-[10px]", `border-b-[${extractedColor}]`);
  }
  if (addMxAuto && !out.some((t) => normalizeToken(t) === "mx-auto")) out.push("mx-auto");
  return [...new Set(out)].filter(Boolean);
};

/** Default to filled; only use stroke with explicit hints. */
const preferFilledBar = (node, tokens) => {
  if (hasExplicitStrokeHint(node)) return false;
  const normalized = tokens.map(normalizeToken);
  const hasBg = normalized.some((t) => BG_COLOR.test(t));
  if (hasBg) return true;
  return true;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let normalized = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (!isBarCandidate(node, nodes, childrenMap, nodeIndex)) return;

    const tokens = getClassTokens(node.attrs);
    const color = extractBarColor(tokens);
    if (!color) return;

    const parent = node.parentIndex != null ? nodes[node.parentIndex] : null;
    const parentTokens = parent?.attrs ? getClassTokens(parent.attrs) : [];
    const parentCore = parentTokens.map(normalizeToken);
    const parentHasTextCenter = parentCore.includes("text-center");
    const parentIsFlexOrGrid = parentCore.includes("flex") || parentCore.includes("inline-flex") || parentCore.includes("grid") || parentCore.includes("inline-grid");
    const addMxAuto = parentHasTextCenter && !parentIsFlexOrGrid;

    const widthToken = getBarWidthToken(node, tokens);
    const filled = preferFilledBar(node, tokens);
    const newTokens = buildNormalizedBarClasses(tokens, color, widthToken, filled, addMxAuto);
    setClassTokens(node.attrs, node.attrOrder, newTokens);

    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "classReplace",
      value: "normalize bar to w-[100px] h-[10px] bg or border-b",
      reason: "Normalized underline/marker bar; removed padding from bar",
    });
    normalized += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
