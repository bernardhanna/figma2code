const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/layoutModel/inferGridFromRepeatingCards";

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

const isGridContainer = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => c === "grid" || /^grid-cols-/.test(c));
};

const isCardLike = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasBg = cores.some((c) => /^bg-/.test(c));
  const hasPadding = cores.some((c) => /^p-/.test(c) || /^px-/.test(c) || /^py-/.test(c));
  return hasBg && hasPadding;
};

const getSharedBg = (tokensList) => {
  if (!tokensList.length) return null;
  const first = tokensList[0].map(normalizeToken).filter((c) => /^bg-/.test(c));
  for (const bg of first) {
    if (tokensList.every((toks) => toks.map(normalizeToken).includes(bg))) return bg;
  }
  return null;
};

const getGapToken = (tokens) => {
  const cores = tokens.map(normalizeToken);
  for (let i = 0; i < cores.length; i += 1) {
    if (/^gap-/.test(cores[i])) return tokens[i];
  }
  return null;
};

const isRowWrapper = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasFlexRow = cores.some((c) => c === "flex-row");
  const hasGap = cores.some((c) => /^gap-/.test(c));
  if (!hasFlexRow || !hasGap) return false;
  const allowed = (c) =>
    c === "flex" ||
    c === "inline-flex" ||
    c === "flex-row" ||
    c === "flex-wrap" ||
    /^gap-/.test(c) ||
    /^items-/.test(c) ||
    /^justify-/.test(c) ||
    c === "w-full";
  return cores.every((c) => allowed(c));
};

const stripFlexTokens = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return tokens.filter((t, i) => {
    const c = cores[i];
    if (c === "flex" || c === "inline-flex" || c === "flex-row" || c === "flex-col" || c === "flex-wrap") return false;
    if (/^grid-cols-/.test(c) || c === "grid" || c === "inline-grid") return false;
    return true;
  });
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { upgraded: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let upgraded = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const parentTokens = getClassTokens(node.attrs);
    if (isGridContainer(parentTokens)) return;
    const childIdxs = (childrenMap.get(nodeIndex) || []).filter((i) => nodes[i]?.tag);
    if (childIdxs.length < 2) return;

    // Case 1: two-or-more row wrappers each with 2 card children.
    const rowWrappers = childIdxs
      .map((i) => ({ idx: i, node: nodes[i] }))
      .filter((r) => r.node?.attrs && isRowWrapper(getClassTokens(r.node.attrs)));

    if (rowWrappers.length >= 2 && rowWrappers.length === childIdxs.length) {
      const rows = rowWrappers;
      const cards = [];
      let validRows = true;
      rows.forEach((row) => {
        const rowChildren = (childrenMap.get(row.idx) || []).filter((i) => nodes[i]?.tag);
        if (rowChildren.length !== 2) validRows = false;
        const rowCardTokens = rowChildren.map((i) => getClassTokens(nodes[i].attrs || {}));
        if (!rowCardTokens.every(isCardLike)) validRows = false;
        rowChildren.forEach((i) => cards.push(i));
      });
      if (validRows) {
        const gapToken = getGapToken(getClassTokens(rows[0].node.attrs)) || getGapToken(parentTokens);
        if (!gapToken) return;
        const sharedBg = getSharedBg(cards.map((i) => getClassTokens(nodes[i].attrs || {})));
        if (!sharedBg) return;

        const baseTokens = stripFlexTokens(parentTokens).filter((t) => !/^gap-/.test(normalizeToken(t)));
        const seen = new Set(baseTokens.map(normalizeToken));
        ["grid", "grid-cols-1", "md:grid-cols-2", gapToken].forEach((t) => {
          const c = normalizeToken(t);
          if (!seen.has(c)) {
            baseTokens.push(t);
            seen.add(c);
          }
        });
        setClassTokens(node.attrs, node.attrOrder, baseTokens);
        const open = buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing);
        const cardHtml = cards.map((i) => source.slice(nodes[i].openStart, nodes[i].closeEnd)).join("");
        const replacement = open + cardHtml + `</${node.tag}>`;
        patches.push(createPatch(node.openStart, node.closeEnd, replacement));
        const meta = getNodeMeta(node);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "layoutReplace",
          value: "infer grid from repeating cards",
          reason: "Flattened row wrappers into a single grid container",
        });
        upgraded += 1;
        return;
      }
    }

    // Case 2: direct card children (2 or 4).
    if (childIdxs.length === 2 || childIdxs.length === 4) {
      const childTokens = childIdxs.map((i) => getClassTokens(nodes[i].attrs || {}));
      if (!childTokens.every(isCardLike)) return;
      const sharedBg = getSharedBg(childTokens);
      if (!sharedBg) return;
      const gapToken = getGapToken(parentTokens);
      if (!gapToken) return;

      const baseTokens = stripFlexTokens(parentTokens).filter((t) => !/^gap-/.test(normalizeToken(t)));
      const seen = new Set(baseTokens.map(normalizeToken));
      ["grid", "grid-cols-1", "md:grid-cols-2", gapToken].forEach((t) => {
        const c = normalizeToken(t);
        if (!seen.has(c)) {
          baseTokens.push(t);
          seen.add(c);
        }
      });
      setClassTokens(node.attrs, node.attrOrder, baseTokens);
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
        op: "classReplace",
        value: "infer grid from repeating cards",
        reason: "Converted repeating cards to grid layout",
      });
      upgraded += 1;
    }
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { upgraded },
  };
};

module.exports = {
  id,
  apply,
};
