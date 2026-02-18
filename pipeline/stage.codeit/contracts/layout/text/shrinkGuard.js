const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/text/shrinkGuard";

const normalizeToken = (token) => String(token || "").split(":").pop();

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li"]);

const hasWrappingTokens = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => c === "break-words" || c === "break-all" || c === "whitespace-pre-wrap" || c === "whitespace-normal");
};

const isDeliberateNoWrap = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => c === "whitespace-nowrap" || c === "truncate" || c === "overflow-ellipsis");
};

const parentIsFlexRow = (nodes, node) => {
  const parent = node.parentIndex != null ? nodes[node.parentIndex] : null;
  if (!parent?.attrs) return false;
  const cores = getClassTokens(parent.attrs).map(normalizeToken);
  return cores.includes("flex-row");
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let removed = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const tag = (node.tag || "").toLowerCase();
    if (!TEXT_TAGS.has(tag)) return;

    const tokens = getClassTokens(node.attrs);
    const cores = tokens.map(normalizeToken);
    if (!cores.includes("shrink-0")) return;

    if (isDeliberateNoWrap(tokens) && parentIsFlexRow(nodes, node)) return;
    if (!hasWrappingTokens(tokens)) return;

    const cleaned = tokens.filter((t) => normalizeToken(t) !== "shrink-0");
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
      op: "classRemove",
      value: "shrink-0",
      reason: "Removed shrink-0 to allow text wrapping",
    });
    removed += 1;
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
