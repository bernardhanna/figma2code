const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/display/dedupeDisplay";

const DISPLAY_GRID = new Set(["grid", "inline-grid"]);
const DISPLAY_FLEX = new Set(["flex", "inline-flex"]);
const DISPLAY_OTHER = new Set(["block", "inline-block", "inline", "contents", "hidden"]);

const normalizeToken = (token) => String(token || "").split(":").pop();

/** Which display group (A=grid, B=flex, C=other) the token belongs to. */
const displayGroup = (core) => {
  if (DISPLAY_GRID.has(core)) return "grid";
  if (DISPLAY_FLEX.has(core)) return "flex";
  if (DISPLAY_OTHER.has(core)) return "other";
  return null;
};

/** Choose single display intent: "grid" | "flex" | "inline-flex" | null (keep first/only). */
const resolveDisplay = (node, normalized) => {
  const hasGridCols = normalized.some((t) => /^grid-cols-/.test(t));
  const hasGap = normalized.some((t) => /^gap-/.test(t));
  const hasFlexCol = normalized.some((t) => t === "flex-col");
  const hasFlexRow = normalized.some((t) => t === "flex-row");
  const hasItems = normalized.some((t) => /^items-/.test(t));
  const hasJustify = normalized.some((t) => /^justify-/.test(t));
  const hasBtn = normalized.some((t) => t === "btn");
  const tag = (node.tag || "").toLowerCase();
  const isButtonOrLink = tag === "button" || tag === "a";

  const hasGrid = normalized.some((t) => DISPLAY_GRID.has(t));
  const hasFlex = normalized.some((t) => t === "flex");
  const hasInlineFlex = normalized.some((t) => t === "inline-flex");
  const hasFlexIntent = hasFlexCol || hasFlexRow || hasItems || hasJustify;

  if (hasFlexIntent && !hasGridCols) {
    if (hasInlineFlex && !hasFlex && hasBtn && (hasFlexCol || hasFlexRow)) return "flex";
    if (hasInlineFlex || hasGrid) return "flex";
  }
  if ((hasGridCols || hasGap) && !hasFlexIntent) {
    if (hasFlex || hasInlineFlex || hasGrid) return "grid";
  }
  if (isButtonOrLink && !hasFlexCol && !hasFlexRow && hasInlineFlex) {
    return "inline-flex";
  }
  if (hasFlex) return "flex";
  if (hasInlineFlex) return "inline-flex";
  if (hasGrid) return "grid";
  const otherDisplay = normalized.find((t) => DISPLAY_OTHER.has(t));
  if (otherDisplay) return "other";
  return null;
};

/** Return the single display token to keep (with original token form for responsive). */
const pickDisplayToken = (tokens, chosen) => {
  if (!chosen || chosen === "other") return null;
  const normalized = tokens.map(normalizeToken);
  if (chosen === "grid") {
    const idx = normalized.findIndex((t) => DISPLAY_GRID.has(t));
    return idx >= 0 ? tokens[idx] : "grid";
  }
  if (chosen === "flex") {
    const idx = normalized.findIndex((t) => t === "flex");
    return idx >= 0 ? tokens[idx] : "flex";
  }
  if (chosen === "inline-flex") {
    const idx = normalized.findIndex((t) => t === "inline-flex");
    return idx >= 0 ? tokens[idx] : "inline-flex";
  }
  return null;
};

/** Remove all display tokens from tokens array. */
const removeDisplayTokens = (tokens) => {
  const normalized = tokens.map(normalizeToken);
  return tokens.filter((t, i) => !displayGroup(normalized[i]));
};

/** Dedupe tokens by normalized core (keep first occurrence). */
const dedupeByCore = (tokens) => {
  const seen = new Set();
  return tokens.filter((t) => {
    const c = normalizeToken(t);
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
};

/** Canonical order: flex/grid first, then flex-col/flex-row, then items-/justify- utilities, then gap, then rest. */
const canonicalOrder = (tokens) => {
  const normalized = tokens.map(normalizeToken);
  const display = [];
  const flexDir = [];
  const align = [];
  const gap = [];
  const rest = [];
  const gapSeen = new Set();
  tokens.forEach((t, i) => {
    const c = normalized[i];
    if (DISPLAY_GRID.has(c) || c === "flex" || c === "inline-flex") display.push(t);
    else if (c === "flex-col" || c === "flex-row") flexDir.push(t);
    else if (/^items-/.test(c) || /^justify-/.test(c)) align.push(t);
    else if (/^gap-/.test(c)) {
      if (!gapSeen.has(c)) { gap.push(t); gapSeen.add(c); }
    }
    else rest.push(t);
  });
  return [...display, ...flexDir, ...align, ...gap, ...rest];
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { deduped: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let deduped = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const normalized = tokens.map(normalizeToken);
    const displayTokens = normalized
      .map((t, i) => (displayGroup(t) ? { core: t, original: tokens[i] } : null))
      .filter(Boolean);

    const hasFlexDir = normalized.some((t) => t === "flex-col" || t === "flex-row");
    const hasAlign = normalized.some((t) => /^items-/.test(t) || /^justify-/.test(t));
    const hasGridCols = normalized.some((t) => /^grid-cols-/.test(t));
    const hasFlexDisplay = normalized.some((t) => t === "flex" || t === "inline-flex");

    let out = dedupeByCore(tokens);
    let added = false;
    if ((hasFlexDir || hasAlign) && !hasFlexDisplay) {
      out.push("flex");
      added = true;
    }
    if (hasGridCols && !normalized.some((t) => DISPLAY_GRID.has(t))) {
      out.push("grid");
      added = true;
    }
    out = canonicalOrder(out);

    const needsDedupe = displayTokens.length > 1;
    if (!needsDedupe) {
      if (added || out.length !== tokens.length || JSON.stringify(out) !== JSON.stringify(tokens)) {
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
          op: "classAdd",
          value: added ? "display consistency" : "canonical order/dedupe",
          reason: "Added flex/grid for direction/cols or canonicalized display",
        });
        deduped += 1;
      }
      return;
    }

    const chosen = resolveDisplay(node, normalized);
    const toKeep = pickDisplayToken(tokens, chosen);
    out = removeDisplayTokens(tokens);
    if (toKeep) out.push(toKeep);

    const outNormalized = out.map(normalizeToken);
    if (hasFlexDir && !outNormalized.some((t) => t === "flex" || t === "inline-flex")) {
      out.push("flex");
    }
    if (hasGridCols && !outNormalized.some((t) => DISPLAY_GRID.has(t))) {
      out.push("grid");
    }
    out = dedupeByCore(out);
    out = canonicalOrder(out);

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
      value: "dedupe display",
      reason: "Resolved conflicting display classes",
    });
    deduped += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { deduped },
  };
};

module.exports = {
  id,
  apply,
};
