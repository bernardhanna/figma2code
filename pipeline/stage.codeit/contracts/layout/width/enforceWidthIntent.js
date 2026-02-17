const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "layout/width/enforceWidthIntent";

const normalizeToken = (token) => String(token || "").split(":").pop();
const tokenPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(":");
};

const hasWidthConstraint = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => /^w-/.test(c) || /^max-w-/.test(c) || /^basis-/.test(c));
};

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li"]);

const getWidthFromData = (node) => {
  const wRem = String(getAttrValue(node.attrs, "data-w-rem") || "").trim();
  if (wRem && /^[0-9.]+rem$/.test(wRem)) return `w-[${wRem}]`;
  const wPx = String(getAttrValue(node.attrs, "data-w-px") || "").trim();
  if (wPx && /^[0-9.]+px$/.test(wPx)) return `w-[${wPx}]`;
  return null;
};

const isWidthToken = (token) => {
  const core = normalizeToken(token);
  return /^w-/.test(core) || /^max-w-/.test(core) || /^basis-/.test(core);
};

const isDecorative = (node) => {
  const decorative = String(getAttrValue(node.attrs, "data-decorative") || "").trim();
  if (decorative === "1" || decorative.toLowerCase() === "true") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("decorativebar")) return true;
  return false;
};

const isTextNode = (node) => TEXT_TAGS.has(String(node?.tag || "").toLowerCase());
const isButtonLike = (node, tokens) => {
  const tag = String(node?.tag || "").toLowerCase();
  if (tag === "button") return true;
  if (tag === "a") return true;
  return (tokens || []).some((t) => normalizeToken(t) === "btn");
};

const parseRemFromDataWRem = (node) => {
  const raw = String(getAttrValue(node?.attrs, "data-w-rem") || "").trim();
  const m = raw.match(/^([0-9.]+)rem$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const parseFirstRemFromWidthToken = (tokens, familyPrefix = "w") => {
  const list = Array.isArray(tokens) ? tokens : [];
  for (const t of list) {
    const core = normalizeToken(t);
    const m = core.match(new RegExp(`^${familyPrefix}-\\[([0-9.]+)rem\\]$`));
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const widthRemForNode = (node, tokens) => {
  const fromData = parseRemFromDataWRem(node);
  if (fromData != null) return fromData;
  const fromW = parseFirstRemFromWidthToken(tokens, "w");
  if (fromW != null) return fromW;
  return parseFirstRemFromWidthToken(tokens, "max-w");
};

const parseRemFromWidthToken = (token) => {
  const m = String(token || "").match(/^w-\[([0-9.]+)rem\]$/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
};

const hasDesktopWidthToken = (tokens) =>
  tokens.some((t) => {
    const p = tokenPrefix(t);
    return p.split(":").some((seg) => seg === "md" || seg === "lg" || seg === "xl" || seg === "2xl");
  });

const withUnique = (tokens) => Array.from(new Set((tokens || []).filter(Boolean)));
const formatRemValue = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(6)));
};

const isAllowedException = (node) => {
  if (!node?.attrs) return false;
  if (isMediaTag(node.tag)) return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (/hero|media|image|banner|bg/i.test(dataKey)) return true;
  const dataIntent = String(getAttrValue(node.attrs, "data-w-intent") || "");
  if (dataIntent.toLowerCase() === "fixed" && /hero|media|image|banner|bg/i.test(String(getAttrValue(node.attrs, "data-node") || ""))) {
    return true;
  }
  return false;
};

const hasAncestorCanonicalContainer = (nodes, node, remValue) => {
  if (!Number.isFinite(remValue) || remValue <= 0) return false;
  const maxWToken = `max-w-[${formatRemValue(remValue)}rem]`;
  let p = node?.parentIndex;
  let sawWFull = false;
  let sawMxAuto = false;
  let sawMaxW = false;
  while (p != null && nodes[p]) {
    const tokens = getClassTokens(nodes[p].attrs || []).map((t) => normalizeToken(t));
    if (tokens.includes("w-full")) sawWFull = true;
    if (tokens.includes("mx-auto")) sawMxAuto = true;
    if (tokens.includes(maxWToken)) sawMaxW = true;
    p = nodes[p].parentIndex;
  }
  return sawWFull && sawMxAuto && sawMaxW;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { enforced: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let enforced = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
    if (intent !== "fixed") return;
    if (isAllowedException(node)) return;

    const tokens = getClassTokens(node.attrs);
    const parent = node.parentIndex != null ? nodes[node.parentIndex] : null;
    const parentTokens = parent?.attrs ? getClassTokens(parent.attrs) : [];
    const parentRem = widthRemForNode(parent, parentTokens);
    const widthFromData = getWidthFromData(node);
    const hasConstraint = hasWidthConstraint(tokens);
    const fixedRem = widthFromData ? parseRemFromWidthToken(widthFromData) : null;
    const shouldPromoteResponsive =
      !!widthFromData &&
      !isDecorative(node) &&
      !isTextNode(node) &&
      !isMediaTag(node.tag) &&
      fixedRem !== null &&
      fixedRem >= 10 &&
      !hasDesktopWidthToken(tokens);
    const parentIsColumn = parentTokens.some((t) => normalizeToken(t) === "flex-col");
    const childRem = widthRemForNode(node, tokens);
    const hasComparableWidths = childRem != null && parentRem != null;
    const widthDelta = hasComparableWidths ? Math.abs(parentRem - childRem) : Number.POSITIVE_INFINITY;
    const widthTolerance = hasComparableWidths ? Math.max(0.5, parentRem * 0.03) : 0.5;
    const matchesParentWidth = hasComparableWidths && widthDelta <= widthTolerance;
    const significantlyNarrower = hasComparableWidths && childRem + 1.0 < parentRem;
    const shouldForceFillForButton =
      isButtonLike(node, tokens) &&
      parentIsColumn &&
      ((fixedRem !== null && fixedRem >= 12) || matchesParentWidth);
    const underCanonicalAncestorContainer =
      fixedRem !== null && hasAncestorCanonicalContainer(nodes, node, fixedRem);
    if (
      widthFromData &&
      tokens.some((t) => normalizeToken(t) === widthFromData) &&
      !underCanonicalAncestorContainer &&
      !shouldPromoteResponsive &&
      !shouldForceFillForButton
    ) {
      return;
    }
    if (hasConstraint && !widthFromData) return;

    let cleaned = [...tokens];
    if (
      widthFromData &&
      !underCanonicalAncestorContainer &&
      !cleaned.some((t) => normalizeToken(t) === widthFromData)
    ) {
      cleaned.push(widthFromData);
    }

    if (widthFromData && !underCanonicalAncestorContainer) {
      const keepWidthToken = (t) => {
        const core = normalizeToken(t);
        if (core === widthFromData) return true;
        if (String(t).includes(":") && isWidthToken(t)) return true;
        return !isWidthToken(t);
      };
      cleaned = cleaned.filter(keepWidthToken);
    } else if (underCanonicalAncestorContainer) {
      cleaned = cleaned.filter((t) => {
        if (!isWidthToken(t)) return true;
        if (String(t).includes(":")) return true;
        return normalizeToken(t) === "w-full";
      });
      if (!cleaned.some((t) => normalizeToken(t) === "w-full")) cleaned.push("w-full");
    }

    // Breakpoint-aware propagation:
    // For fixed-width non-text wrappers, prefer mobile-safe base width and keep fixed width at md+.
    // This preserves desktop constraints while preventing mobile clipping.
    if (widthFromData && !isDecorative(node) && !isTextNode(node) && !isMediaTag(node.tag)) {
      if (shouldForceFillForButton) {
        cleaned = cleaned.filter((t) => {
          const core = normalizeToken(t);
          if (core === "self-center") return false;
          if (isWidthToken(t) && !String(t).includes(":")) {
            if (significantlyNarrower && /^max-w-\[/.test(core)) return true;
            return false;
          }
          return true;
        });
        cleaned.push("self-stretch");
        cleaned.push("w-full");
        cleaned.push("max-w-full");
        if (significantlyNarrower && childRem != null) {
          const remVal = formatRemValue(childRem);
          if (remVal) cleaned.push(`max-w-[${remVal}rem]`);
        }
      }
      if (shouldPromoteResponsive && !shouldForceFillForButton && !hasDesktopWidthToken(cleaned)) {
        cleaned = cleaned.filter((t) => {
          if (!isWidthToken(t)) return true;
          const p = tokenPrefix(t);
          if (p) return true; // keep existing responsive width tokens
          return normalizeToken(t) !== widthFromData;
        });
        cleaned.push("w-full");
        cleaned.push(`md:${widthFromData}`);
        cleaned.push("max-w-full");
      }
    }

    cleaned = withUnique(cleaned);

    if (widthFromData && isDecorative(node)) {
      setClassTokens(node.attrs, node.attrOrder, cleaned);
      setAttrValue(node.attrs, node.attrOrder, "data-w-intent", "fixed");
    } else if (widthFromData) {
      setClassTokens(node.attrs, node.attrOrder, cleaned);
      setAttrValue(node.attrs, node.attrOrder, "data-w-intent", "fixed");
    } else {
      if (!cleaned.some((t) => normalizeToken(t) === "w-full")) cleaned.push("w-full");
      if (!cleaned.some((t) => normalizeToken(t) === "max-w-full")) cleaned.push("max-w-full");
      setClassTokens(node.attrs, node.attrOrder, cleaned);
      setAttrValue(node.attrs, node.attrOrder, "data-w-intent", "fill");
    }

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
      op: "enforceWidthIntent",
      value: "fixed intent normalized",
      reason: "Fixed width intent without matching width constraint",
    });
    enforced += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { enforced },
  };
};

module.exports = {
  id,
  apply,
};
