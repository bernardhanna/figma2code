"use strict";

const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "layout/root/removeFrameDimensions";

const LAYOUT_WRAPPER_TAGS = new Set([
  "section",
  "div",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "p",
]);

/** Base (unprefixed) fixed width: w-[number rem|px] */
const BASE_FIXED_WIDTH = /^w-\[[0-9.]+(rem|px)\]$/;
/** Base (unprefixed) fixed height: h-[number rem|px] */
const BASE_FIXED_HEIGHT = /^h-\[[0-9.]+(rem|px)\]$/;

const DATA_KEY_MEDIA_OR_DECORATIVE = /image|img|media|hero|background|divider|decorativebar/i;

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

const normalizeToken = (token) => String(token || "").split(":").pop();

const isBaseFixedWidth = (token) => {
  if (String(token).includes(":")) return false;
  return BASE_FIXED_WIDTH.test(normalizeToken(token));
};

const isBaseFixedHeight = (token) => {
  if (String(token).includes(":")) return false;
  return BASE_FIXED_HEIGHT.test(normalizeToken(token));
};

const isRootLayout = (node, nodes) => {
  const dataKey = String(getAttrValue(node?.attrs, "data-key") || "");
  if (dataKey === "root") return true;
  const tag = (node?.tag || "").toLowerCase();
  if (tag !== "section") return false;
  const parentIndex = node.parentIndex;
  if (parentIndex == null) return true;
  const parent = nodes[parentIndex];
  return (parent?.tag || "").toLowerCase() !== "section";
};

/** Direct child is a media element. */
const hasDirectMediaChild = (nodes, childrenMap, nodeIndex) => {
  const childIndices = childrenMap.get(nodeIndex) || [];
  return childIndices.some((idx) => isMediaTag(nodes[idx]?.tag));
};

const isMediaWrapper = (node, nodes, childrenMap, nodeIndex) => {
  const dataKey = String(getAttrValue(node?.attrs, "data-key") || "");
  if (DATA_KEY_MEDIA_OR_DECORATIVE.test(dataKey)) return true;
  return hasDirectMediaChild(nodes, childrenMap, nodeIndex);
};

const isDecorativeBar = (node) => {
  if (getAttrValue(node?.attrs, "data-decorative") === "1") return true;
  const dataKey = String(getAttrValue(node?.attrs, "data-key") || "");
  return /decorativebar|divider/i.test(dataKey);
};

/** Keep width/height on media, media wrappers, decorative bars. Do not strip from these. */
const isKeepCase = (node, nodes, childrenMap, nodeIndex) => {
  if (isMediaTag(node.tag)) return true;
  if (isDecorativeBar(node)) return true;
  if (isMediaWrapper(node, nodes, childrenMap, nodeIndex)) return true;
  return false;
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
    const tag = (node?.tag || "").toLowerCase();
    if (!LAYOUT_WRAPPER_TAGS.has(tag)) return;
    if (isKeepCase(node, nodes, childrenMap, nodeIndex)) return;

    const tokens = getClassTokens(node.attrs);
    const removedWidth = [];
    const removedHeight = [];
    const cleaned = [];

    for (const token of tokens) {
      if (isBaseFixedWidth(token)) {
        removedWidth.push(token);
        continue;
      }
      if (isBaseFixedHeight(token)) {
        removedHeight.push(token);
        continue;
      }
      cleaned.push(token);
    }

    const rootLayout = isRootLayout(node, nodes);
    const hadAnyWidth = removedWidth.length > 0;
    const hadAnyHeight = removedHeight.length > 0;
    if (rootLayout) {
      if (!hadAnyWidth && !hadAnyHeight) return;
    } else {
      if (!hadAnyWidth && !hadAnyHeight) return;
    }

    if (hadAnyWidth && !cleaned.some((t) => normalizeToken(t) === "w-full")) {
      cleaned.push("w-full");
    }

    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );

    const meta = getNodeMeta(node);
    [...removedWidth, ...removedHeight].forEach((token) => {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classRemove",
        value: token,
        reason: "Removed frame dimension from layout/root wrapper",
      });
    });
    removed += removedWidth.length + removedHeight.length;
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
