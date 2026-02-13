const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/align/centerCardContent";

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

const isCardContainer = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasBg = cores.some((c) => /^bg-/.test(c));
  const hasPadding = cores.some((c) => /^p-/.test(c) || /^px-/.test(c) || /^py-/.test(c));
  return hasBg && hasPadding;
};

const hasDescendantTextCenter = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) continue;
    const tokens = getClassTokens(node.attrs);
    if (tokens.some((t) => normalizeToken(t) === "text-center")) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

const hasBreakpointItemsCenter = (tokens) =>
  tokens.some((t) => normalizeToken(t) === "items-center" && String(t).includes(":"));

const hasBaseItemsCenter = (tokens) =>
  tokens.some((t) => normalizeToken(t) === "items-center" && !String(t).includes(":"));

const hasBaseItemsStart = (tokens) =>
  tokens.some((t) => normalizeToken(t) === "items-start" && !String(t).includes(":"));

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { added: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let added = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;
    if (!isCardContainer(tokens)) return;
    if (hasBaseItemsCenter(tokens)) return;
    if (hasBaseItemsStart(tokens)) return;
    if (!hasBreakpointItemsCenter(tokens)) return;
    if (!hasDescendantTextCenter(nodes, childrenMap, nodeIndex)) return;

    const cleaned = [...tokens, "items-center"];
    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "classAdd",
      value: "items-center",
      reason: "Center card content on mobile when descendants are centered",
    });
    added += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { added },
  };
};

module.exports = {
  id,
  apply,
};
