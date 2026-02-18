const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/text/nowrapGuard";

const normalizeToken = (token) => String(token || "").split(":").pop();

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li"]);

const isWidthConstrained = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => /^max-w-/.test(c) || (/^w-/.test(c) && c !== "w-full"));
};

const isCardContainer = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasBg = cores.some((c) => /^bg-/.test(c));
  const hasPadding = cores.some((c) => /^p-/.test(c) || /^px-/.test(c) || /^py-/.test(c));
  return hasBg && hasPadding;
};

const isBadgeLike = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasRoundedFull = cores.some((c) => c === "rounded-full");
  const hasPadding = cores.some((c) => /^px-/.test(c) || /^py-/.test(c) || /^p-/.test(c));
  const isInline = cores.some((c) => c === "inline-flex" || c === "inline-block");
  return hasRoundedFull && hasPadding && isInline;
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
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;
    const cores = tokens.map(normalizeToken);
    if (!cores.includes("whitespace-nowrap")) return;

    const tag = (node.tag || "").toLowerCase();
    const cardLike = isCardContainer(tokens);
    const textLike = TEXT_TAGS.has(tag);
    const constrained = isWidthConstrained(tokens);
    if (isBadgeLike(tokens)) return;

    if (!(cardLike || (textLike && constrained))) return;

    const cleaned = tokens.filter((t) => normalizeToken(t) !== "whitespace-nowrap");
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
      value: "whitespace-nowrap",
      reason: "Removed nowrap to avoid clipping in constrained layouts",
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
