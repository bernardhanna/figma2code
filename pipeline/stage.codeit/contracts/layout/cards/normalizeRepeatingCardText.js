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

const id = "layout/cards/normalizeRepeatingCardText";

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

const normalizeKeyForShape = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/item#\d+/g, "item#*")
    .replace(/name#\d+/g, "name#*")
    .replace(/text:[^#/]+/g, "text:*")
    .replace(/#\d+/g, "#*");

const findTextBlockChild = (nodes, childrenMap, itemIndex) => {
  const children = getElementChildren(nodes, childrenMap, itemIndex);
  for (const idx of children) {
    const key = String(getAttrValue(nodes[idx]?.attrs || {}, "data-key") || "").toLowerCase();
    if (key.includes("/frame:name#")) return idx;
  }
  return null;
};

const collectSubtree = (nodes, childrenMap, rootIndex) => {
  const out = [];
  const walk = (idx) => {
    const node = nodes[idx];
    if (!node?.tag) return;
    out.push(idx);
    const children = getElementChildren(nodes, childrenMap, idx);
    children.forEach(walk);
  };
  walk(rootIndex);
  return out;
};

const structureSignature = (nodes, childrenMap, rootIndex) => {
  const parts = [];
  const walk = (idx) => {
    const node = nodes[idx];
    if (!node?.tag) return;
    const tag = String(node.tag || "").toLowerCase();
    const key = normalizeKeyForShape(getAttrValue(node.attrs || {}, "data-key"));
    const children = getElementChildren(nodes, childrenMap, idx);
    parts.push(`${tag}|${key}|${children.length}`);
    children.forEach(walk);
  };
  walk(rootIndex);
  return parts.join(">");
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  let normalized = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const itemChildren = getElementChildren(nodes, childrenMap, nodeIndex).filter((idx) => {
      const key = String(getAttrValue(nodes[idx]?.attrs || {}, "data-key") || "");
      return ITEM_KEY_RE.test(key);
    });
    if (itemChildren.length < 2) return;

    const textBlocks = itemChildren.map((idx) => findTextBlockChild(nodes, childrenMap, idx));
    if (textBlocks.some((idx) => idx == null)) return;

    const signatures = textBlocks.map((idx) => structureSignature(nodes, childrenMap, idx));
    const baseSignature = signatures[0];
    if (!signatures.every((sig) => sig === baseSignature)) return;

    const templateNodes = collectSubtree(nodes, childrenMap, textBlocks[0]);
    for (let i = 1; i < textBlocks.length; i += 1) {
      const targetNodes = collectSubtree(nodes, childrenMap, textBlocks[i]);
      if (targetNodes.length !== templateNodes.length) continue;
      for (let j = 0; j < templateNodes.length; j += 1) {
        const srcNode = nodes[templateNodes[j]];
        const dstNode = nodes[targetNodes[j]];
        if (!srcNode?.attrs || !dstNode?.attrs) continue;
        if (String(srcNode.tag || "").toLowerCase() !== String(dstNode.tag || "").toLowerCase()) continue;
        const srcTokens = getClassTokens(srcNode.attrs);
        const dstTokens = getClassTokens(dstNode.attrs);
        if (srcTokens.length === 0) continue;
        const same =
          srcTokens.length === dstTokens.length && srcTokens.every((token, idx) => token === dstTokens[idx]);
        if (same) continue;
        setClassTokens(dstNode.attrs, dstNode.attrOrder, [...srcTokens]);
        patches.push(
          createPatch(
            dstNode.openStart,
            dstNode.openEnd,
            buildOpenTag(dstNode.tag, dstNode.attrs, dstNode.attrOrder, dstNode.isSelfClosing)
          )
        );
        const meta = getNodeMeta(dstNode);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "normalizeDuplicateTextShape",
          value: "copied class tokens from duplicate template card",
          reason: "Repeated grid cards with exact duplicate structure should share text block styling",
        });
        normalized += 1;
      }
    }
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
