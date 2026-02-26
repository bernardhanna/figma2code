const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/width/pruneRedundantFlexSizing";

const normalizeToken = (token) => String(token || "").split(":").pop();

const hasExactToken = (tokens, value) => tokens.some((t) => String(t || "") === value);

const hasMdRatioSizing = (tokens) =>
  tokens.some((t) => {
    const raw = String(t || "");
    if (!raw.startsWith("md:basis-")) return false;
    return (
      /^md:basis-[1-9]\/[1-9][0-9]*$/.test(raw) ||
      /^md:basis-\[[^\]]+\]$/.test(raw)
    );
  });

const hasMdMaxWAndNoGrow = (tokens) =>
  hasExactToken(tokens, "md:grow-0") &&
  tokens.some((t) => String(t || "").startsWith("md:max-w-"));

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { pruned: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  let pruned = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;
    if (!hasMdRatioSizing(tokens)) return;
    if (!hasMdMaxWAndNoGrow(tokens)) return;

    const next = tokens.filter((t) => {
      const raw = String(t || "");
      const core = normalizeToken(t);
      if (core === "grow" && !raw.includes(":")) return false;
      if (core === "basis-0" && !raw.includes(":")) return false;
      if (raw === "md:flex-1" || raw.endsWith(":md:flex-1")) return false;
      if (raw === "md:basis-0" || raw.endsWith(":md:basis-0")) return false;
      return true;
    });

    if (next.length === tokens.length) return;
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
      op: "classRemove",
      value: "grow basis-0 md:flex-1",
      reason: "Remove redundant flex sizing when md ratio sizing is explicit",
    });
    pruned += 1;
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { pruned },
  };
};

module.exports = { id, apply };
