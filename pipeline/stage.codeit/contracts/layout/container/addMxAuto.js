const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/container/addMxAuto";

const normalizeToken = (token) => String(token || "").split(":").pop();

const hasWFull = (tokens) => tokens.some((t) => normalizeToken(t) === "w-full");
const hasMaxWidth = (tokens) => tokens.some((t) => /^max-w-/.test(normalizeToken(t)));
const hasMxToken = (tokens) => tokens.some((t) => /^mx-/.test(normalizeToken(t)));

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { added: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let added = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;
    if (!hasWFull(tokens) || !hasMaxWidth(tokens)) return;
    if (hasMxToken(tokens)) return;

    const cleaned = [...tokens, "mx-auto"];
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
      value: "mx-auto",
      reason: "Container canonicalizer: w-full + max-w without mx-auto",
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

module.exports = { id, apply };
