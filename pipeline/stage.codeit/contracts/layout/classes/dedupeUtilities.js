const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { dedupeTokens } = require("../../utilities/mutateClasses");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/classes/dedupeUtilities";

const REASON = "Removed duplicate Tailwind class token(s)";

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
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const { cleaned, removed: removedTokens } = dedupeTokens(tokens);
    if (!removedTokens.length) return;

    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );

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
