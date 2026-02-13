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

const id = "layout/width/fluidizeFixedRem";

const normalizeToken = (token) => String(token || "").split(":").pop();

const W_70REM = "w-[70rem]";
const W_34_25REM = "w-[34.25rem]";
const W_30_25REM = "w-[30.25rem]";
const W_20REM = "w-[20rem]";

/** Card inner/content wrapper: fixed rem width + max-w-full, no grow/basis-0 (so not the card itself). */
const getCardInnerWidth = (node, tokens) => {
  if (hasGrowOrBasis0(tokens)) return false;
  const tag = (node.tag || "").toLowerCase();
  if (tag === "img" || tag === "video" || tag === "picture") return false;
  if (!(hasCore(tokens, W_34_25REM) || hasCore(tokens, W_30_25REM))) return false;
  if (!hasMaxWFull(tokens)) return false;
  return hasCore(tokens, W_30_25REM) ? W_30_25REM : W_34_25REM;
};

const hasCore = (tokens, core) =>
  tokens.some((t) => normalizeToken(t) === core);

const hasMaxWFull = (tokens) =>
  tokens.some((t) => normalizeToken(t) === "max-w-full");

const hasGrowOrBasis0 = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return (
    cores.some((c) => c === "grow" || c === "flex-grow") ||
    cores.some((c) => c === "basis-0" || c === "flex-basis-0")
  );
};

/** Parent has flex-row at any breakpoint (base, md, lg, etc.). */
const parentHasFlexRowAtMdOrBase = (nodes, parentIndex) => {
  if (parentIndex == null) return false;
  const parent = nodes[parentIndex];
  if (!parent?.attrs) return false;
  const tokens = getClassTokens(parent.attrs);
  return tokens.some((t) => normalizeToken(t) === "flex-row");
};

/** Remove responsive width tokens that duplicate base (e.g. lg:w-[34.25rem] when w-[34.25rem] exists). */
const removeRedundantBreakpointWidths = (tokens) => {
  let out = [...tokens];
  for (const core of [W_70REM, W_34_25REM, W_30_25REM, W_20REM]) {
    const withCore = tokens.filter((t) => normalizeToken(t) === core);
    const base = withCore.find((t) => !String(t).includes(":"));
    if (!base) continue;
    const toRemove = withCore.filter((t) => t !== base);
    if (toRemove.length) {
      out = out.filter((t) => !toRemove.includes(t));
    }
  }
  return out;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { fluidized: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let fluidized = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    let tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const normalized = tokens.map(normalizeToken);
    let out = removeRedundantBreakpointWidths(tokens);
    let changed = out.length !== tokens.length;
    tokens = out;

    if (hasCore(tokens, W_70REM) && hasMaxWFull(tokens)) {
      out = removeTokens(out, (t) => normalizeToken(t) === W_70REM).cleaned;
      if (!out.some((t) => normalizeToken(t) === "w-full")) out.push("w-full");
      changed = true;
    } else if (getCardInnerWidth(node, tokens)) {
      const fixed = getCardInnerWidth(node, tokens);
      const toRemove = (t) => {
        const c = normalizeToken(t);
        return c === W_34_25REM || c === W_30_25REM || (c.startsWith("w-[") && c.endsWith("rem]"));
      };
      out = removeTokens(out, toRemove).cleaned;
      if (!out.some((t) => normalizeToken(t) === "w-full")) out.push("w-full");
      out = out.filter((t) => normalizeToken(t) !== "max-w-full");
      const maxWValue = fixed ? fixed.replace(/^w-/, "max-w-") : null;
      if (maxWValue && !out.some((t) => normalizeToken(t) === maxWValue)) {
        out.push(maxWValue);
      }
      changed = true;
    } else if (
      (hasCore(tokens, W_34_25REM) || hasCore(tokens, W_30_25REM)) &&
      hasGrowOrBasis0(tokens)
    ) {
      out = removeTokens(out, (t) => {
        const c = normalizeToken(t);
        return c === W_34_25REM || c === W_30_25REM;
      }).cleaned;
      const parentIdx = node.parentIndex;
      const parentFlexRow = parentHasFlexRowAtMdOrBase(nodes, parentIdx);
      if (parentFlexRow) {
        if (!out.some((t) => normalizeToken(t) === "flex-1")) out.push("flex-1");
        if (!out.some((t) => normalizeToken(t) === "min-w-0")) out.push("min-w-0");
      } else {
        if (!out.some((t) => normalizeToken(t) === "w-full")) out.push("w-full");
        if (!out.some((t) => normalizeToken(t) === "md:w-1/2")) out.push("md:w-1/2");
      }
      changed = true;
    } else if (
      (node.tag || "").toLowerCase() === "h3" &&
      hasCore(tokens, W_20REM)
    ) {
      out = removeTokens(out, (t) => normalizeToken(t) === W_20REM).cleaned;
      if (!out.some((t) => normalizeToken(t) === "max-w-[20rem]"))
        out.push("max-w-[20rem]");
      changed = true;
    }

    if (!changed) return;

    setClassTokens(node.attrs, node.attrOrder, out);
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
      value: "fluidize fixed rem widths",
      reason: "Replaced fixed rem widths with fluid rules",
    });
    fluidized += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { fluidized },
  };
};

module.exports = {
  id,
  apply,
};
