const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { removeTokens } = require("../../utilities/mutateClasses");
const { getNodeMeta, isInteractiveTag, isMediaTag } = require("../../utilities/select");

const id = "layout/height/removeFixedHeights";

const HEIGHT_TOKEN = /^(min-h|h)-\[[0-9.]+rem\]$/;
const DATA_KEY_MEDIA = /hero|image|media|bg|banner/i;
const tokenCore = (token) => String(token || "").split(":").pop();
const tokenPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(":");
};

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent === null || parent === undefined) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const hasMediaDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (isMediaTag(node.tag)) return true;
    const kids = childrenMap.get(idx) || [];
    queue.push(...kids);
  }
  return false;
};

/** True if any descendant has position absolute + inset-0 (e.g. background layer) */
const hasAbsoluteInset0Descendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) {
      queue.push(...(childrenMap.get(idx) || []));
      continue;
    }
    const tokens = getClassTokens(node.attrs);
    const normalized = tokens.map((t) => String(t).split(":").pop());
    const hasAbsolute = normalized.some((t) => t === "absolute" || t === "fixed");
    const hasInset0 = normalized.some((t) => /^inset-0$/.test(t) || /^inset-\[0\]$/.test(t));
    if (hasAbsolute && hasInset0) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

/** True if node has overflow-hidden and rounded-* (e.g. image mask) */
const hasOverflowHiddenAndRounded = (attrs) => {
  const tokens = getClassTokens(attrs);
  const normalized = tokens.map((t) => String(t).split(":").pop());
  const overflowHidden = normalized.some((t) => t === "overflow-hidden");
  const rounded = normalized.some((t) => /^rounded/.test(t));
  return overflowHidden && rounded;
};

/** Media wrapper heuristics (preserve height for design fidelity). */
const isMediaWrapper = (node, nodes, childrenMap, nodeIndex) => {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (DATA_KEY_MEDIA.test(dataKey)) return true;
  if (hasMediaDescendant(nodes, childrenMap, nodeIndex)) return true;
  if (hasAbsoluteInset0Descendant(nodes, childrenMap, nodeIndex)) return true;
  if (hasOverflowHiddenAndRounded(node.attrs)) return true;
  return false;
};

/** Do NOT remove height if any of these hold (preserve layout fidelity). */
const shouldKeepHeight = (node, nodes, childrenMap, nodeIndex) => {
  if (isMediaTag(node.tag)) return true;
  if (isInteractiveTag(node.tag)) return true;
  const hIntent = getAttrValue(node.attrs, "data-h-intent");
  if (hIntent === "fixed") return true;
  if (isMediaWrapper(node, nodes, childrenMap, nodeIndex)) return true;
  return false;
};

const isDesktopOrLargerPrefix = (prefix) => {
  const segments = String(prefix || "").split(":").filter(Boolean);
  return segments.some((seg) => seg === "md" || seg === "lg" || seg === "xl" || seg === "2xl");
};

const isHeightToken = (token) => {
  const core = tokenCore(token);
  if (!HEIGHT_TOKEN.test(core)) return false;
  const prefix = tokenPrefix(token);
  // Keep md+/lg+ height constraints; remove base/mobile-only constraints.
  if (isDesktopOrLargerPrefix(prefix)) return false;
  return true;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let removed = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (shouldKeepHeight(node, nodes, childrenMap, nodeIndex)) return;

    const tokens = getClassTokens(node.attrs);
    const { cleaned, removed: removedTokens } = removeTokens(tokens, isHeightToken);
    if (!removedTokens.length) return;

    setClassTokens(node.attrs, node.attrOrder, cleaned);

    patches.push(createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)));

    const meta = getNodeMeta(node);
    removedTokens.forEach((token) => {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classRemove",
        value: token,
        reason: "Removed fixed-height tokens (non-media wrapper)",
      });
    });

    removed += removedTokens.length;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { removed },
  };
};

module.exports = {
  id,
  apply,
};
