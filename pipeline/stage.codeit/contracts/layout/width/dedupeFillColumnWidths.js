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

const id = "layout/width/dedupeFillColumnWidths";

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

const getElementChildren = (nodes, childrenMap, nodeIndex) =>
  (childrenMap.get(nodeIndex) || []).filter((i) => nodes[i]?.tag);

const isFillColumnRoot = (node) => {
  if (!node?.attrs) return false;
  const wIntent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
  if (wIntent !== "fill") return false;
  const tokens = getClassTokens(node.attrs).map(normalizeToken);
  const hasFlexCol = tokens.includes("flex-col");
  const hasWFull = tokens.includes("w-full");
  const hasMaxW = tokens.some((core) => core.startsWith("max-w-") && core !== "max-w-full");
  return hasFlexCol && hasWFull && hasMaxW;
};

const isDecorative = (node) => String(getAttrValue(node?.attrs, "data-decorative") || "") === "1";

const maxWCoreTokens = (tokens) =>
  tokens
    .map(normalizeToken)
    .filter((core) => core.startsWith("max-w-") && core !== "max-w-full");

const removeRedundantForNode = (node, inheritedMaxWCores) => {
  const tokens = getClassTokens(node.attrs);
  if (!tokens.length) return null;
  const next = tokens.filter((token) => {
    const core = normalizeToken(token);
    if (!core.startsWith("max-w-")) return true;
    if (core === "max-w-full") return true;
    if (!inheritedMaxWCores.has(core)) return true;
    return false;
  });
  if (next.length === tokens.length) return null;
  return { tokens, next };
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  let removed = 0;

  const walk = (rootIndex, inheritedMaxW) => {
    const node = nodes[rootIndex];
    if (!node?.attrs) return;
    const children = getElementChildren(nodes, childrenMap, rootIndex);
    let activeMaxW = new Set(inheritedMaxW);

    if (!isMediaTag(node.tag) && !isDecorative(node) && rootIndex !== null) {
      const update = removeRedundantForNode(node, activeMaxW);
      if (update) {
        setClassTokens(node.attrs, node.attrOrder, update.next);
        patches.push(
          createPatch(
            node.openStart,
            node.openEnd,
            buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
          )
        );
        const meta = getNodeMeta(node);
        const removedTokens = update.tokens.filter((t) => !update.next.includes(t));
        removedTokens.forEach((token) => {
          changes.push({
            contractId: id,
            nodeId: meta.nodeId,
            selector: meta.selector,
            op: "classRemove",
            value: token,
            reason: "Redundant max-w token duplicated inside fill-column subtree",
          });
          removed += 1;
        });
      }
    }

    const nodeMaxW = maxWCoreTokens(getClassTokens(node.attrs));
    nodeMaxW.forEach((core) => activeMaxW.add(core));

    children.forEach((childIndex) => walk(childIndex, activeMaxW));
  };

  nodes.forEach((node, idx) => {
    if (!isFillColumnRoot(node)) return;
    const childIndices = getElementChildren(nodes, childrenMap, idx);
    const rootMaxW = new Set(maxWCoreTokens(getClassTokens(node.attrs)));
    childIndices.forEach((childIdx) => walk(childIdx, rootMaxW));
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { removed },
  };
};

module.exports = {
  id,
  apply,
};
