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

const id = "layout/section/enforceMobileVerticalPadding";

const normalizeToken = (token) => String(token || "").split(":").pop();

const getPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(":");
};

const isRootSection = (node, nodes) => {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (dataKey === "root") return true;
  const parentIndex = node.parentIndex;
  if (parentIndex == null) return true;
  const parent = nodes[parentIndex];
  return (parent?.tag || "").toLowerCase() === "body";
};

const getBasePaddingToken = (tokens, type) => {
  let last = null;
  tokens.forEach((t) => {
    if (getPrefix(t) !== "") return;
    const core = normalizeToken(t);
    if (core.startsWith(`${type}-`)) last = t;
  });
  return last;
};

const hasMdPadding = (tokens, type) =>
  tokens.some((t) => getPrefix(t) === "md" && normalizeToken(t).startsWith(`${type}-`));

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if ((node.tag || "").toLowerCase() !== "section") return;
    if (!isRootSection(node, nodes)) return;

    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const basePt = getBasePaddingToken(tokens, "pt");
    const basePb = getBasePaddingToken(tokens, "pb");
    const mdHasPt = hasMdPadding(tokens, "pt");
    const mdHasPb = hasMdPadding(tokens, "pb");

    let next = [...tokens];
    let changed = false;

    if (basePt && normalizeToken(basePt) !== "pt-[2.5rem]") {
      next = next.filter((t) => !(getPrefix(t) === "" && normalizeToken(t).startsWith("pt-")));
      const insertAt = Math.min(tokens.lastIndexOf(basePt), next.length);
      next.splice(insertAt, 0, "pt-[2.5rem]");
      if (!mdHasPt) next.splice(insertAt + 1, 0, `md:${normalizeToken(basePt)}`);
      changed = true;
    }

    if (basePb && normalizeToken(basePb) !== "pb-[2.5rem]") {
      next = next.filter((t) => !(getPrefix(t) === "" && normalizeToken(t).startsWith("pb-")));
      const insertAt = Math.min(tokens.lastIndexOf(basePb), next.length);
      next.splice(insertAt, 0, "pb-[2.5rem]");
      if (!mdHasPb) next.splice(insertAt + 1, 0, `md:${normalizeToken(basePb)}`);
      changed = true;
    }

    if (!changed) return;

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
      op: "paddingNormalize",
      value: "enforce mobile vertical padding",
      reason: "Normalized base pt/pb to 2.5rem and preserved md values",
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
