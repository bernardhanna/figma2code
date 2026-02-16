const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { removeTokens } = require("../../utilities/mutateClasses");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/width/normalizeContainerWidths";

/** Base token (no breakpoint prefix). */
const normalizeToken = (token) => String(token || "").split(":").pop();

/** Has mx-auto at any breakpoint. */
const hasMxAuto = (tokens) =>
  tokens.some((t) => normalizeToken(t) === "mx-auto");

/** Has any max-w-* (max-w-container, max-w-[...], etc.). */
const hasMaxW = (tokens) =>
  tokens.some((t) => /^max-w-/.test(normalizeToken(t)));

/** Has w-full, w-screen, or arbitrary w-[...]. */
const hasWFullOrScreenOrFixed = (tokens) =>
  tokens.some((t) => {
    const c = normalizeToken(t);
    return c === "w-full" || c === "w-screen" || /^w-\[.+\]$/.test(c);
  });

/** Fixed width utility (arbitrary value): w-[...]. */
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

    const wIntent = getAttrValue(node.attrs, "data-w-intent");
    let tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const hasMx = hasMxAuto(tokens);
    const hasMax = hasMaxW(tokens);
    if (wIntent === "fixed" && (!hasMx || !hasMax)) return;

    if (!hasMx || !hasMax) return;
    if (!hasWFullOrScreenOrFixed(tokens)) return;

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
      op: "normalizeContainerWidth",
      value: "remove fixed w-[...] from centered container",
      reason: "Container has mx-auto + max-w-*; fixed width removed, w-full ensured",
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
