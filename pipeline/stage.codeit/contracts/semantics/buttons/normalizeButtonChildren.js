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

const id = "semantics/buttons/normalizeButtonChildren";

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

/** Direct child indices of nodeIndex. */
const getDirectChildren = (childrenMap, nodeIndex) =>
  childrenMap.get(nodeIndex) || [];

/** Button has justify-center (any breakpoint). */
const buttonHasJustifyCenter = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  return tokens.some((t) => normalizeToken(t) === "justify-center");
};

/** Replace text-left with text-center in token list. */
const replaceTextLeftWithCenter = (tokens) =>
  tokens.map((t) => {
    const core = normalizeToken(t);
    return core === "text-left" ? "text-center" : t;
  });

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let normalized = 0;

  nodes.forEach((node, nodeIndex) => {
    const tag = (node?.tag || "").toLowerCase();
    if (tag !== "button") return;
    if (node.isSelfClosing) return;

    const directChildren = getDirectChildren(childrenMap, nodeIndex);

    directChildren.forEach((childIdx) => {
      const child = nodes[childIdx];
      if (!child || (child.tag || "").toLowerCase() !== "p") return;

      let spanAttrs = { ...child.attrs };
      let spanOrder = [...(child.attrOrder || Object.keys(child.attrs || {}))];

      const isOnlyChild = directChildren.length === 1;
      if (isOnlyChild && buttonHasJustifyCenter(node.attrs)) {
        const tokens = getClassTokens(spanAttrs);
        const hasTextLeft = tokens.some((t) => normalizeToken(t) === "text-left");
        if (hasTextLeft) {
          const newTokens = replaceTextLeftWithCenter(tokens);
          setClassTokens(spanAttrs, spanOrder, newTokens);
        }
      }

      const spanOpen = buildOpenTag("span", spanAttrs, spanOrder, false);
      patches.push(createPatch(child.openStart, child.openEnd, spanOpen));
      if (child.closeStart != null && child.closeEnd != null) {
        patches.push(createPatch(child.closeStart, child.closeEnd, "</span>"));
      }
      const meta = getNodeMeta(child);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "pToSpan",
        value: "p→span",
        reason: "Button may not contain <p>; use <span> for label",
      });
      normalized += 1;
    });

    if (directChildren.length === 0 && node.closeStart != null && node.closeEnd != null) {
      const innerContent = source.slice(node.openEnd, node.closeStart);
      if (innerContent.indexOf("<") === -1 && innerContent.length > 0) {
        const wrapped = `<span>${innerContent}</span>`;
        patches.push(createPatch(node.openEnd, node.closeStart, wrapped));
        const meta = getNodeMeta(node);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "wrapText",
          value: "wrap bare text in span",
          reason: "Button text wrapped in span for valid markup",
        });
        normalized += 1;
      }
    }
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
