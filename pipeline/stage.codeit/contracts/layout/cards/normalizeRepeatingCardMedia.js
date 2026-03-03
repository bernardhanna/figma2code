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

const id = "layout/cards/normalizeRepeatingCardMedia";

const ITEM_KEY_RE = /(?:^|\/)frame:item#\d+(?:\/|$)/i;

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node?.parentIndex;
    if (parent == null) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const getElementChildren = (nodes, childrenMap, nodeIndex) =>
  (childrenMap.get(nodeIndex) || []).filter((idx) => Boolean(nodes[idx]?.tag));

const hasRepeatingItemAncestor = (nodes, nodeIndex) => {
  let cur = nodes[nodeIndex]?.parentIndex;
  while (cur != null && nodes[cur]) {
    const key = String(getAttrValue(nodes[cur].attrs || {}, "data-key") || "");
    if (ITEM_KEY_RE.test(key)) return true;
    cur = nodes[cur].parentIndex;
  }
  return false;
};

const ensureImageClasses = (imgNode) => {
  const tokens = getClassTokens(imgNode.attrs || {});
  const next = [...tokens];
  const add = (token) => {
    if (!next.includes(token)) next.push(token);
  };
  add("w-full");
  add("h-full");
  add("rounded-[inherit]");
  setClassTokens(imgNode.attrs, imgNode.attrOrder, next);
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { unwrapped: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  let unwrapped = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tag = String(node.tag || "").toLowerCase();
    if (tag !== "div") return;

    const key = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
    if (!key.includes("rectangle:image")) return;

    const parentIndex = node.parentIndex;
    if (parentIndex == null || !nodes[parentIndex]?.attrs) return;
    const parentKey = String(getAttrValue(nodes[parentIndex].attrs || {}, "data-key") || "").toLowerCase();
    if (!parentKey.includes("frame:image")) return;
    if (!hasRepeatingItemAncestor(nodes, nodeIndex)) return;

    const childIdxs = getElementChildren(nodes, childrenMap, nodeIndex);
    if (childIdxs.length !== 1) return;
    const child = nodes[childIdxs[0]];
    if (String(child?.tag || "").toLowerCase() !== "img") return;

    ensureImageClasses(child);
    patches.push(
      createPatch(
        child.openStart,
        child.openEnd,
        buildOpenTag(child.tag, child.attrs, child.attrOrder, child.isSelfClosing)
      )
    );
    patches.push(createPatch(node.openStart, node.openEnd, ""));
    if (node.closeStart != null && node.closeEnd != null) {
      patches.push(createPatch(node.closeStart, node.closeEnd, ""));
    }

    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "unwrapRectangleImageLayer",
      value: "flattened rectangle:image wrapper into direct img child",
      reason: "Keep repeated grid cards structurally consistent across items",
    });
    unwrapped += 1;
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { unwrapped },
  };
};

module.exports = {
  id,
  apply,
};
