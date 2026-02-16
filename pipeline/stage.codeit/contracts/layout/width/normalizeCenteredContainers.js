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

const id = "layout/width/normalizeCenteredContainers";

/** Base token (no breakpoint prefix). */
const normalizeToken = (token) => String(token || "").split(":").pop();

/** Class contains mx-auto (any breakpoint). */
const hasMxAuto = (tokens) =>
  tokens.some((t) => normalizeToken(t) === "mx-auto");

/** Class contains max-w-* (max-w-container, max-w-[...], etc.). */
const hasMaxW = (tokens) =>
  tokens.some((t) => /^max-w-/.test(normalizeToken(t)));

/** Fixed width utility: w-[...]. */
const isFixedWidthToken = (token) =>
  /^w-\[.+\]$/.test(normalizeToken(token));

const MEDIA_TAGS = new Set(["img", "video", "svg", "picture", "canvas"]);
const isMediaTag = (tag) => MEDIA_TAGS.has(String(tag || "").toLowerCase());

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let normalized = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const tag = (node.tag || "").toLowerCase();
    if (isMediaTag(tag)) return;

    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    if (!hasMxAuto(tokens) || !hasMaxW(tokens)) return;

    const fixedWidthTokens = tokens.filter(isFixedWidthToken);
    if (!fixedWidthTokens.length) return;

    const { cleaned: out } = removeTokens(tokens, isFixedWidthToken);
    if (!out.some((t) => normalizeToken(t) === "w-full")) out.push("w-full");

    setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), out);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "normalizeCenteredContainer",
      value: "remove fixed w-[...], ensure w-full",
      reason: "Centered container (mx-auto + max-w-*): fixed width removed",
    });
    normalized += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
