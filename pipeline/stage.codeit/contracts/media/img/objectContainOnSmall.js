const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "media/img/objectContainOnSmall";

/**
 * Normalize token by removing responsive prefix (e.g., "max-md:object-cover" → "object-cover")
 */
const normalizeToken = (token) => String(token || "").split(":").pop();

/**
 * Check if token is an object-fit utility.
 */
const isObjectToken = (token) => {
  const core = normalizeToken(token);
  return /^object-(cover|contain|fill|none|scale-down)$/.test(core);
};

/**
 * Check if tokens already have max-md/max-sm object-* override
 */
const hasObjectOverride = (tokens) => {
  return tokens.some((t) => /^max-(?:sm|md):object-(cover|contain|fill|none|scale-down)$/.test(String(t || "")));
};

/**
 * Check if tokens include object-cover.
 */
const hasObjectCover = (tokens) => {
  return tokens.some((t) => normalizeToken(t) === "object-cover");
};

/**
 * Insert token before the first matching token; fallback append.
 */
const insertBeforeFirst = (tokens, tokenToInsert, predicate) => {
  if (tokens.includes(tokenToInsert)) return tokens.slice();
  const result = [];
  let inserted = false;
  for (const token of tokens) {
    if (!inserted && predicate(token)) {
      result.push(tokenToInsert);
      inserted = true;
    }
    result.push(token);
  }
  if (!inserted) result.push(tokenToInsert);
  return result;
};

const isHeightCore = (core) => /^h-/.test(core) && core !== "h-auto";
const isMinHeightCore = (core) => /^min-h-/.test(core) && core !== "min-h-0";
const isMaxHeightCore = (core) => /^max-h-/.test(core) && core !== "max-h-none";

const hasHeightToken = (tokens) => tokens.some((t) => isHeightCore(normalizeToken(t)));
const hasMinHeightToken = (tokens) => tokens.some((t) => isMinHeightCore(normalizeToken(t)));
const hasMaxHeightToken = (tokens) => tokens.some((t) => isMaxHeightCore(normalizeToken(t)));

const hasMaxMdHeightOverride = (tokens) => tokens.some((t) => String(t) === "max-md:h-auto" || String(t) === "max-sm:h-auto");

const addContainAndHeightOverrides = (tokens) => {
  let next = insertBeforeFirst(
    tokens,
    "max-md:object-contain",
    (token) => normalizeToken(token) === "object-cover" || isObjectToken(token)
  );

  if (hasHeightToken(tokens)) {
    next = insertBeforeFirst(next, "max-md:h-auto", (token) => isHeightCore(normalizeToken(token)));
  }
  if (hasMinHeightToken(tokens)) {
    next = insertBeforeFirst(next, "max-md:min-h-0", (token) => /^min-h-/.test(normalizeToken(token)));
  }
  if (hasMaxHeightToken(tokens)) {
    next = insertBeforeFirst(next, "max-md:max-h-none", (token) => /^max-h-/.test(normalizeToken(token)));
  }
  return next;
};

/** Add only max-md height overrides (no object-fit). Used for wrapper so it can shrink when img uses contain. */
const addHeightOverridesOnly = (tokens) => {
  let next = tokens.slice();
  if (hasHeightToken(next)) {
    next = insertBeforeFirst(next, "max-md:h-auto", (token) => isHeightCore(normalizeToken(token)));
  }
  if (hasMinHeightToken(next)) {
    next = insertBeforeFirst(next, "max-md:min-h-0", (token) => /^min-h-/.test(normalizeToken(token)));
  }
  if (hasMaxHeightToken(next)) {
    next = insertBeforeFirst(next, "max-md:max-h-none", (token) => /^max-h-/.test(normalizeToken(token)));
  }
  return next;
};

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent == null) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) {
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };
  }

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  let adjusted = 0;
  const parentIndicesToPatch = new Set();

  nodes.forEach((node, nodeIndex) => {
    // Only target <img> elements
    if (node.tag !== "img") return;
    if (!node?.attrs) return;

    const tokens = getClassTokens(node.attrs);

    // Skip if no object-cover at base level
    if (!hasObjectCover(tokens)) return;

    // Skip if already has small-screen object-* override (but we may still need to relax the wrapper).
    const alreadyHadContain = hasObjectOverride(tokens);
    if (!alreadyHadContain) {
      // Add max-md object-fit and height overrides for small screens.
      const updated = addContainAndHeightOverrides(tokens);

      setClassTokens(node.attrs, node.attrOrder, updated);
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
        value: "max-md:object-contain",
        reason: "Add max-md overrides for object fit and height on small screens",
      });

      adjusted += 1;
    }

    // When img has (or just got) max-md contain, relax wrapper height at max-md so the container can shrink.
    const parentIndex = node.parentIndex;
    if (parentIndex == null) return;
    const parent = nodes[parentIndex];
    if (!parent || (parent.tag || "").toLowerCase() !== "div" || !parent.attrs) return;
    const siblings = childrenMap.get(parentIndex) || [];
    if (siblings.length !== 1 || siblings[0] !== nodeIndex) return;
    const parentTokens = getClassTokens(parent.attrs);
    if (!hasHeightToken(parentTokens) && !hasMinHeightToken(parentTokens) && !hasMaxHeightToken(parentTokens)) return;
    if (hasMaxMdHeightOverride(parentTokens)) return;
    parentIndicesToPatch.add(parentIndex);
  });

  // Patch wrapper divs: add max-md height overrides so wrapper height becomes auto at small breakpoint.
  parentIndicesToPatch.forEach((parentIndex) => {
    const parent = nodes[parentIndex];
    const parentTokens = getClassTokens(parent.attrs);
    const updated = addHeightOverridesOnly(parentTokens);
    setClassTokens(parent.attrs, parent.attrOrder, updated);
    patches.push(
      createPatch(
        parent.openStart,
        parent.openEnd,
        buildOpenTag(parent.tag, parent.attrs, parent.attrOrder, parent.isSelfClosing)
      )
    );
    const meta = getNodeMeta(parent);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "classAdd",
      value: "max-md:h-auto",
      reason: "Relax wrapper height at max-md when img uses object-contain",
    });
    adjusted += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings: [],
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};
