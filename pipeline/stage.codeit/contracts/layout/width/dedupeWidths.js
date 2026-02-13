const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { removeTokens } = require("../../utilities/mutateClasses");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/width/dedupeWidths";

const WIDTH_TOKEN = /^w-\[[^\]]+\]$/;

const isWidthToken = (token) => WIDTH_TOKEN.test(String(token || "").split(":").pop());

const hasWidthControl = (tokens) =>
  tokens.some((token) => {
    const core = String(token || "").split(":").pop();
    return core === "w-full" || core === "w-screen" || isWidthToken(core);
  });

const hasMaxWFull = (tokens) =>
  tokens.some((token) => String(token || "").split(":").pop() === "max-w-full");

const REASON = "Resolved conflicting Tailwind class token(s)";

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
    if (node.parentIndex === null || node.parentIndex === undefined) return;

    const parent = nodes[node.parentIndex];
    if (!parent?.attrs) return;

    const tokens = getClassTokens(node.attrs);
    const parentTokens = getClassTokens(parent.attrs);
    if (!tokens.length || !parentTokens.length) return;

    const childHasMaxWFull = hasMaxWFull(tokens);
    const childWidthTokens = tokens.filter((token) => isWidthToken(token));

    if (!childHasMaxWFull || !childWidthTokens.length) return;

    if (!hasWidthControl(parentTokens)) {
      const meta = getNodeMeta(node);
      warnings.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        message: "Skipped width dedupe: parent width control not detected.",
      });
      return;
    }

    const { cleaned, removed: removedTokens } = removeTokens(tokens, (token) =>
      childWidthTokens.includes(token)
    );
    if (!removedTokens.length) return;

    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)));

    const meta = getNodeMeta(node);
    removedTokens.forEach((token) => {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classRemove",
        value: token,
        reason: REASON,
      });
    });
    removed += removedTokens.length;
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
