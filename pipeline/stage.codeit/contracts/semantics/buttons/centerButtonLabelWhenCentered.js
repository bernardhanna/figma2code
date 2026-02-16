const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "semantics/buttons/centerButtonLabelWhenCentered";

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

const getDirectChildren = (childrenMap, nodeIndex) =>
  childrenMap.get(nodeIndex) || [];

const hasJustifyCenter = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  return tokens.some((t) => normalizeToken(t) === "justify-center");
};

const isLabelTag = (tag) => {
  const t = (tag || "").toLowerCase();
  return t === "span" || t === "p";
};

/** Replace text-left with text-center in token list. */
const replaceTextLeftWithCenter = (tokens) =>
  tokens.map((t) => (normalizeToken(t) === "text-left" ? "text-center" : t));

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if ((node?.tag || "").toLowerCase() !== "button") return;
    if (node.isSelfClosing) return;
    if (!hasJustifyCenter(node.attrs)) return;

    const directChildren = getDirectChildren(childrenMap, nodeIndex);
    if (directChildren.length !== 1) return;

    const label = nodes[directChildren[0]];
    if (!label || !isLabelTag(label.tag)) return;

    const tokens = getClassTokens(label.attrs || {});
    if (!tokens.some((t) => normalizeToken(t) === "text-left")) return;

    const newTokens = replaceTextLeftWithCenter(tokens);
    const attrs = { ...label.attrs };
    const order = [...(label.attrOrder || Object.keys(label.attrs || {}))];
    setClassTokens(attrs, order, newTokens);

    const newOpen = buildOpenTag(label.tag, attrs, order, false);
    patches.push(createPatch(label.openStart, label.openEnd, newOpen));

    const meta = getNodeMeta(label);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "centerLabel",
      value: "text-left→text-center",
      reason: "Button is justify-center; single label aligned to center",
    });
    adjusted += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};
