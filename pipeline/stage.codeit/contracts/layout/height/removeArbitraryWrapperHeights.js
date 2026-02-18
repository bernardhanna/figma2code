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

const id = "layout/height/removeArbitraryWrapperHeights";

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

/** Arbitrary height: h-[...] (any value). Responsive variants included via normalizeToken. */
const ARBITRARY_HEIGHT = /^h-\[.+\]$/;

/** Height tokens we never remove (viewport, divider, line). */
const KEEP_HEIGHT_CORES = new Set([
  "h-auto", "h-full", "h-screen", "h-px",
  "min-h-screen", "min-h-0",
  "h-[1px]", "h-[0.3125rem]",
]);
const isKeepHeightCore = (core) => KEEP_HEIGHT_CORES.has(core) || /^h-\[1px\]$/.test(core) || /^h-\[0\.3125rem\]$/.test(core);

/** Token is an arbitrary height we may remove (h-[...] and not in keep list). */
const isArbitraryHeightToken = (token) => {
  const core = normalizeToken(token);
  if (isKeepHeightCore(core)) return false;
  return ARBITRARY_HEIGHT.test(core);
};

/** Node has viewport constraint: min-h-screen or h-screen. */
const hasViewportHeight = (tokens) =>
  tokens.some((t) => {
    const c = normalizeToken(t);
    return c === "h-screen" || c === "min-h-screen";
  });

/** Node is divider/line (very small height). */
const isDividerHeight = (tokens) =>
  tokens.some((t) => {
    const c = normalizeToken(t);
    return c === "h-px" || c === "h-[1px]" || /^h-\[0\.3125rem\]$/.test(c);
  });

/** Direct child indices. */
const getDirectChildren = (childrenMap, nodeIndex) => childrenMap.get(nodeIndex) || [];

/** True if node has direct img/video child with object-cover. */
const hasDirectMediaChildWithObjectCover = (nodes, childrenMap, nodeIndex) => {
  const childIdxs = getDirectChildren(childrenMap, nodeIndex);
  for (const idx of childIdxs) {
    const child = nodes[idx];
    if (!child) continue;
    const tag = (child.tag || "").toLowerCase();
    if (tag !== "img" && tag !== "video") continue;
    const tokens = getClassTokens(child.attrs || {});
    const cores = tokens.map(normalizeToken);
    if (cores.some((c) => c === "object-cover")) return true;
  }
  return false;
};

/** Subtree has object-cover on some node. */
const hasObjectCoverDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...getDirectChildren(childrenMap, nodeIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) {
      queue.push(...getDirectChildren(childrenMap, idx));
      continue;
    }
    const tokens = getClassTokens(node.attrs);
    if (tokens.some((t) => normalizeToken(t) === "object-cover")) return true;
    queue.push(...getDirectChildren(childrenMap, idx));
  }
  return false;
};

/** Node has overflow-hidden in class. */
const hasOverflowHidden = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  return tokens.some((t) => normalizeToken(t) === "overflow-hidden");
};

/** data-key suggests image/frame. */
const dataKeySuggestsImageFrame = (attrs) => {
  const key = String(getAttrValue(attrs, "data-key") || "");
  return /image|frame/i.test(key);
};

/** Primary purpose is media framing: direct img/video with object-cover, or overflow-hidden + object-cover descendant + image/frame hint. */
const isMediaFramingWrapper = (node, nodes, childrenMap, nodeIndex) => {
  if (hasDirectMediaChildWithObjectCover(nodes, childrenMap, nodeIndex)) return true;
  if (
    hasOverflowHidden(node.attrs) &&
    hasObjectCoverDescendant(nodes, childrenMap, nodeIndex) &&
    dataKeySuggestsImageFrame(node.attrs)
  ) return true;
  return false;
};

/** Do NOT remove height (keep rules). */
const shouldKeepHeight = (node, nodes, childrenMap, nodeIndex) => {
  if (isMediaTag(node.tag)) return true;
  if (isMediaFramingWrapper(node, nodes, childrenMap, nodeIndex)) return true;
  const tokens = getClassTokens(node.attrs || {});
  if (hasViewportHeight(tokens)) return true;
  if (isDividerHeight(tokens)) return true;
  if (getAttrValue(node.attrs, "data-decorative") === "1") return true;
  return false;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

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
    const { cleaned: out, removed: removedTokens } = removeTokens(tokens, isArbitraryHeightToken);
    if (!removedTokens.length) return;

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
    removedTokens.forEach((token) => {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "heightRemove",
        value: token,
        reason: "Removed arbitrary wrapper height, added h-auto",
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
