const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/grid/stripFlexChildSizing";

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

const isGridContainer = (node) => {
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => c === "grid" || /^grid-cols-/.test(c));
};

const hasFlexContainer = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => c === "flex" || c === "inline-flex");
};

const hasTextOverflowHints = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => c === "break-words" || c === "break-all" || c === "truncate" || c === "overflow-ellipsis" || c === "whitespace-nowrap");
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { stripped: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let stripped = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (!isGridContainer(node)) return;

    const children = childrenMap.get(nodeIndex) || [];
    children.forEach((childIndex) => {
      const child = nodes[childIndex];
      if (!child?.attrs) return;
      const tokens = getClassTokens(child.attrs);
      if (!tokens.length) return;

      const keepMinW0 = hasFlexContainer(tokens) && hasTextOverflowHints(tokens);
      const cleaned = tokens.filter((t) => {
        const c = normalizeToken(t);
        if (c === "flex-1" || c === "grow") return false;
        if (/^basis-/.test(c)) return false;
        if (c === "self-center") return false;
        if (c === "min-w-0" && !keepMinW0) return false;
        return true;
      });

      if (cleaned.length === tokens.length) return;

      setClassTokens(child.attrs, child.attrOrder, cleaned);
      patches.push(
        createPatch(
          child.openStart,
          child.openEnd,
          buildOpenTag(child.tag, child.attrs, child.attrOrder, child.isSelfClosing)
        )
      );
      const meta = getNodeMeta(child);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classReplace",
        value: "strip flex sizing for grid child",
        reason: "Removed flex sizing tokens from grid children",
      });
      stripped += 1;
    });
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
