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
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "layout/height/stripWrapperFixedHeightsStrict";

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

/** Decorative / very small heights we never remove. */
const DECORATIVE_HEIGHT_CORES = new Set([
  "h-auto", "h-px", "h-[1px]", "h-[0.3125rem]",
]);
const isDecorativeHeightCore = (core) =>
  DECORATIVE_HEIGHT_CORES.has(core) ||
  /^h-\[0\.3125rem\]$/.test(core) ||
  /^h-\[1px\]$/.test(core);

/** Any height token: h-[...], h-*, min-h-*. */
const isHeightToken = (token) => {
  const c = normalizeToken(token);
  return /^h-\[.+\]$/.test(c) || /^h-[a-z0-9.-]+$/.test(c) || /^min-h-/.test(c);
};

/** Removable: height token that is not decorative (we strip fixed heights only). */
const isRemovableHeightToken = (token) => {
  if (!isHeightToken(token)) return false;
  const c = normalizeToken(token);
  if (isDecorativeHeightCore(c)) return false;
  return true;
};

/** Direct child indices. */
const getDirectChildren = (childrenMap, nodeIndex) =>
  childrenMap.get(nodeIndex) || [];

const hasBackgroundImageIntent = (node) => {
  const attrs = node?.attrs || {};
  const style = String(getAttrValue(attrs, "style") || "");
  if (/background-image\s*:/i.test(style)) return true;
  const cores = getClassTokens(attrs).map(normalizeToken);
  return cores.some((c) => /^bg-\[.*url\(/i.test(c));
};

const isAbsoluteBackgroundFillLayer = (node) => {
  if (!node?.attrs) return false;
  const cores = getClassTokens(node.attrs).map(normalizeToken);
  const absolute = cores.includes("absolute");
  const inset0 = cores.includes("inset-0");
  const bgCoverLike = cores.includes("bg-cover") || cores.includes("bg-contain");
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  const figmaRectImageLike = /rectangle:image|image-/.test(dataKey);
  const bgImage = hasBackgroundImageIntent(node);
  return absolute && inset0 && bgCoverLike && (bgImage || figmaRectImageLike);
};

/** True media wrapper: overflow-hidden AND first child is img/video with object-cover or object-contain. */
const isTrueMediaWrapper = (node, nodes, childrenMap, nodeIndex) => {
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  if (!cores.some((c) => c === "overflow-hidden")) return false;
  const childIdxs = getDirectChildren(childrenMap, nodeIndex);
  if (childIdxs.length === 0) return false;
  const firstChild = nodes[childIdxs[0]];
  if (!firstChild) return false;
  const tag = (firstChild.tag || "").toLowerCase();
  if (tag !== "img" && tag !== "video") return false;
  const childTokens = getClassTokens(firstChild.attrs || {});
  const childCores = childTokens.map(normalizeToken);
  if (!childCores.some((c) => c === "object-cover" || c === "object-contain")) return false;
  return true;
};

const wrapsAbsoluteBackgroundLayer = (nodes, childrenMap, nodeIndex) => {
  const childIdxs = getDirectChildren(childrenMap, nodeIndex);
  if (!childIdxs.length) return false;
  return childIdxs.some((idx) => isAbsoluteBackgroundFillLayer(nodes[idx]));
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { stripped: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let stripped = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tag = (node.tag || "").toLowerCase();
    if (isMediaTag(tag)) return;
    if (getAttrValue(node.attrs, "data-decorative") === "1") return;

    const tokens = getClassTokens(node.attrs);
    const removable = tokens.filter(isRemovableHeightToken);
    if (removable.length === 0) return;

    if (isTrueMediaWrapper(node, nodes, childrenMap, nodeIndex)) return;
    if (isAbsoluteBackgroundFillLayer(node)) return;
    if (wrapsAbsoluteBackgroundLayer(nodes, childrenMap, nodeIndex)) return;

    const { cleaned: out } = removeTokens(tokens, isRemovableHeightToken);
    if (!out.some((t) => normalizeToken(t) === "h-auto")) out.push("h-auto");

    setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), out);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "stripFixedHeight",
      value: "remove fixed height from wrapper",
      reason: "Non-media wrapper: fixed height removed, h-auto ensured",
    });
    stripped += removable.length;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { stripped },
  };
};

module.exports = {
  id,
  apply,
};
