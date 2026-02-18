const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/grid/upgradeToGridForMatrices";

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

/** Node has flex-col (or responsive) and gap. */
const isFlexColWithGap = (node) => {
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  const hasFlexCol = cores.some((c) => c === "flex-col");
  const hasGap = cores.some((c) => /^gap-/.test(c));
  return hasFlexCol && hasGap;
};

/** Node has md:flex-row (or base flex-row) and gap. */
const isRowWithGap = (node) => {
  const tokens = getClassTokens(node.attrs || {});
  const hasFlexRow = tokens.some((t) => {
    const c = normalizeToken(t);
    return c === "flex-row" || t.startsWith("md:flex-row");
  });
  const hasGap = tokens.some((t) => /^gap-/.test(normalizeToken(t)));
  return hasFlexRow && hasGap;
};

/** Extract first gap-* token (e.g. gap-[1.5rem]) for grid. */
const getGapToken = (tokens) => {
  const t = tokens.find((tok) => /^gap-/.test(normalizeToken(tok)));
  return t || "gap-[1.5rem]";
};

/** Card has flex-1 / basis-0 / grow. */
const isCardLike = (node) => {
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  return (
    cores.some((c) => c === "flex-1" || c === "grow") ||
    cores.some((c) => c === "basis-0")
  );
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { upgraded: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let upgraded = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node || (node.tag || "").toLowerCase() !== "div") return;
    if (node.isSelfClosing || node.closeStart == null) return;
    if (!isFlexColWithGap(node)) return;

    const childIndices = childrenMap.get(nodeIndex);
    if (!childIndices || childIndices.length !== 2) return;

    const [row1Idx, row2Idx] = childIndices;
    const row1 = nodes[row1Idx];
    const row2 = nodes[row2Idx];
    if (!row1 || !row2 || (row1.tag || "").toLowerCase() !== "div" || (row2.tag || "").toLowerCase() !== "div") return;
    if (!isRowWithGap(row1) || !isRowWithGap(row2)) return;

    const row1Children = childrenMap.get(row1Idx);
    const row2Children = childrenMap.get(row2Idx);
    if (!row1Children || row1Children.length !== 2 || !row2Children || row2Children.length !== 2) return;

    const [c1, c2] = row1Children;
    const [c3, c4] = row2Children;
    if (![c1, c2, c3, c4].every((i) => nodes[i] && isCardLike(nodes[i]))) return;

    const gapToken = getGapToken(getClassTokens(row1.attrs || {}));
    const newAttrs = { ...node.attrs };
    const newOrder = [...(node.attrOrder || [])];
    const existingTokens = getClassTokens(node.attrs || {});
    const normalized = existingTokens.map(normalizeToken);
    const keep = existingTokens.filter((t, i) => {
      const c = normalizeToken(t);
      if (c === "flex" || c === "flex-col" || c === "flex-row") return false;
      if (t.startsWith("md:flex-row") || /^gap-/.test(c)) return false;
      return true;
    });
    const seen = new Set(keep.map(normalizeToken));
    const gridTokens = ["grid", "grid-cols-1", "md:grid-cols-2", gapToken];
    gridTokens.forEach((t) => { const c = normalizeToken(t); if (!seen.has(c)) { keep.push(t); seen.add(c); } });
    setClassTokens(newAttrs, newOrder, keep);

    const newOpen = buildOpenTag("div", newAttrs, newOrder, false);
    const card1Html = source.slice(nodes[c1].openStart, nodes[c1].closeEnd);
    const card2Html = source.slice(nodes[c2].openStart, nodes[c2].closeEnd);
    const card3Html = source.slice(nodes[c3].openStart, nodes[c3].closeEnd);
    const card4Html = source.slice(nodes[c4].openStart, nodes[c4].closeEnd);
    const replacement = newOpen + card1Html + card2Html + card3Html + card4Html + "</div>";

    patches.push(createPatch(node.openStart, node.closeEnd, replacement));
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "upgradeToGrid",
      value: "2x2 matrix → grid",
      reason: "Replaced two flex rows with single grid grid-cols-1 md:grid-cols-2",
    });
    upgraded += 1;
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
