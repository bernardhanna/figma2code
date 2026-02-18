const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/text/textFixedWidthGuardContract";

const TEXT_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"]);

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

const isSpanInTextBlock = (nodes, nodeIndex) => {
  const parentIndex = nodes[nodeIndex]?.parentIndex;
  if (parentIndex == null) return false;
  const parentTag = (nodes[parentIndex]?.tag || "").toLowerCase();
  return TEXT_TAGS.has(parentTag);
};

const isTargetNode = (nodes, nodeIndex) => {
  const node = nodes[nodeIndex];
  if (!node?.attrs) return false;
  const tag = (node.tag || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) return true;
  if (tag === "span" && isSpanInTextBlock(nodes, nodeIndex)) return true;
  return false;
};

const hasAncestorTokenCore = (nodes, nodeIndex, coreToken) => {
  let current = nodes[nodeIndex]?.parentIndex;
  while (current != null) {
    const node = nodes[current];
    const cores = getClassTokens(node?.attrs || {}).map(normalizeToken);
    if (cores.includes(coreToken)) return true;
    current = node?.parentIndex;
  }
  return false;
};

const hasAbsoluteOrFixed = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.includes("absolute") || cores.includes("fixed");
};

const hasOverflowXContext = (nodes, childrenMap, nodeIndex) => {
  let current = nodes[nodeIndex]?.parentIndex;
  while (current != null) {
    const node = nodes[current];
    const tokens = getClassTokens(node.attrs || {});
    const cores = tokens.map(normalizeToken);
    if (cores.includes("whitespace-nowrap")) return true;
    if (cores.includes("overflow-x-auto") || cores.includes("overflow-x-scroll")) return true;
    current = node.parentIndex;
  }
  return false;
};

const getBaseWidthToken = (tokens) =>
  tokens.find((t) => {
    if (String(t).includes(":")) return false;
    const c = normalizeToken(t);
    return /^w-\[\d/.test(c) && (c.endsWith("rem]") || c.endsWith("px]"));
  });

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!isTargetNode(nodes, nodeIndex)) return;
    const tokens = getClassTokens(node.attrs || {});
    if (!tokens.length) return;

    const widthToken = getBaseWidthToken(tokens);
    if (!widthToken) return;
    if (hasAbsoluteOrFixed(tokens)) return;
    if (hasOverflowXContext(nodes, childrenMap, nodeIndex)) return;

    const widthValue = normalizeToken(widthToken).replace(/^w-/, "max-w-");
    const hasWFull = tokens.some((t) => normalizeToken(t) === "w-full");
    const hasMaxW = tokens.some((t) => normalizeToken(t) === widthValue);
    const hasMaxWFull = tokens.some((t) => normalizeToken(t) === "max-w-full");
    const ancestorHasSameMaxW = hasAncestorTokenCore(nodes, nodeIndex, widthValue);

    let next = tokens.filter((t) => t !== widthToken);
    if (ancestorHasSameMaxW) {
      next = next.filter((t) => {
        const core = normalizeToken(t);
        return core !== widthValue && core !== "max-w-full";
      });
    }
    if (!hasWFull) next.push("w-full");
    if (!ancestorHasSameMaxW && !hasMaxW) next.push(widthValue);
    if (!ancestorHasSameMaxW && !hasMaxWFull) next.push("max-w-full");

    setClassTokens(node.attrs, node.attrOrder, next);
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
      op: "textWidthNormalize",
      value: "w-[X] -> w-full max-w-[X] max-w-full",
      reason: "Text width made responsive without changing content or typography",
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
