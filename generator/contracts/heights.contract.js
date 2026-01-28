// generator/contracts/heightsContract.js
import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

// Match bracket heights, including responsive variants (md:h-[...], max-md:h-[...], etc.)
const HEIGHT_TOKEN_RE = /^h-\[[^\]]+\]$/;

function splitToken(token) {
  const parts = [];
  let buf = "";
  let depth = 0;

  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === "[") depth += 1;
    if (ch === "]" && depth > 0) depth -= 1;

    if (ch === ":" && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }

  parts.push(buf);
  const base = parts.pop() || "";
  const variant = parts.join(":");
  return { variant, base };
}

function dedupe(tokens) {
  const out = [];
  const seen = new Set();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function hasBracketHeightToken(tokens) {
  return tokens.some((t) => HEIGHT_TOKEN_RE.test(splitToken(t).base));
}

function hasAnyHeightUtility(tokens) {
  // Any utility whose *base* starts with "h-" (includes h-auto, h-full, responsive variants, etc.)
  return tokens.some((t) => splitToken(t).base.startsWith("h-"));
}

function hasMaxMdAuto(tokens) {
  return tokens.some((t) => t === "max-md:h-auto" || t === "md:h-auto");
}

function hasMdBracketHeight(tokens, targetBase /* e.g. h-[48rem] */) {
  const wanted = `md:${targetBase}`;
  return tokens.includes(wanted);
}

function getLabel(node) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  const dataName = String(
    getAttrValue(node.attrs, "data-name") || getAttrValue(node.attrs, "data-node-name") || ""
  );
  return `${dataKey} ${dataName}`.toLowerCase();
}

/**
 * Height intent rules (authoritative):
 * - hug: never emit height utilities
 * - fill: enforce h-full (and remove bracket heights + h-auto)
 * - fixed: keep bracket height (and for media: add max-md:h-auto)
 *
 * IMPORTANT: We do NOT use data-w-intent for height intent. If no data-h-intent exists, default hug.
 */
function getHeightIntent(node) {
  return String(
    getAttrValue(node.attrs, "data-h-intent") || getAttrValue(node.attrs, "data-h-mode") || ""
  ).toLowerCase();
}

function resolveHeightMode(node) {
  const intent = getHeightIntent(node);
  if (intent === "fixed") return "fixed";
  if (intent === "fill") return "fill";
  return "hug";
}

function isDecorativeOrDivider(node) {
  const label = getLabel(node);
  return label.includes("decorativebar") || label.includes("divider");
}

function isHero(node) {
  const label = getLabel(node);
  return label.includes("hero");
}

function isRoot(node) {
  return String(getAttrValue(node.attrs, "data-key") || "").toLowerCase() === "root";
}

function isMediaNode(node) {
  // Media nodes: <img> itself, and wrappers explicitly tagged as media-ish
  if (node.tag === "img") return true;
  const label = getLabel(node);
  return label.includes("image") || label.includes("img") || label.includes("cover");
}

function isButtonLike(node) {
  if (node.tag === "button") return true;
  const tokens = getClassTokens(node.attrs);
  return tokens.includes("btn");
}

function stripAllHeightUtilities(tokens) {
  // Strip anything whose base starts with "h-" (includes h-auto, h-full, md:h-auto, max-md:h-auto, md:h-[...], etc.)
  return tokens.filter((t) => !splitToken(t).base.startsWith("h-"));
}

export const heightsContract = {
  name: "heights",
  order: 210,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;

      // Never let this contract dictate button heights (padding/min-h handles it)
      if (isButtonLike(node)) return;

      // Always preserve decorative bars and dividers (their heights are intentional)
      if (isDecorativeOrDivider(node)) return;

      // Preserve hero rules (if your pipeline relies on fixed hero heights)
      if (isHero(node)) return;

      const mode = resolveHeightMode(node);
      const hasAnyBracketHeight = hasBracketHeightToken(tokens);

      // Root special-case normalization:
      // If root has a fixed bracket height, normalize to:
      //   h-auto md:h-[...]
      //
      // Also remove max-md:h-auto if present (we don't want mobile-only hacks on root).
      if (isRoot(node) && hasAnyBracketHeight) {
        const fixedToken = tokens.find((t) => HEIGHT_TOKEN_RE.test(splitToken(t).base));
        if (!fixedToken) return;

        const { base } = splitToken(fixedToken); // h-[...]
        let nextTokens = tokens.filter((t) => {
          const { base: b } = splitToken(t);
          if (HEIGHT_TOKEN_RE.test(b)) return false; // remove any bracket heights (incl md:...)
          if (t === "max-md:h-auto") return false;
          return true;
        });

        // Ensure fluid base height
        if (!nextTokens.includes("h-auto")) nextTokens.push("h-auto");

        // Ensure md fixed
        if (!hasMdBracketHeight(nextTokens, base)) nextTokens.push(`md:${base}`);

        nextTokens = dedupe(nextTokens);

        const before = tokens.join(" ");
        const after = nextTokens.join(" ");
        if (before === after) return;

        const attrs = { ...node.attrs };
        const order = [...node.attrOrder];
        setClassTokens(attrs, order, nextTokens);
        const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
        patches.push(createPatch(node.openStart, node.openEnd, replacement));
        changedNodes += 1;
        notes.push("Normalized root height to h-auto + md:h-[...].");
        return;
      }

      // HUG: never emit any height utilities at all (even if upstream added h-*)
      if (mode === "hug") {
        if (!hasAnyHeightUtility(tokens) && !hasAnyBracketHeight) return;

        const nextTokens = dedupe(stripAllHeightUtilities(tokens));

        const before = tokens.join(" ");
        const after = nextTokens.join(" ");
        if (before === after) return;

        const attrs = { ...node.attrs };
        const order = [...node.attrOrder];
        setClassTokens(attrs, order, nextTokens);
        const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
        patches.push(createPatch(node.openStart, node.openEnd, replacement));
        changedNodes += 1;
        notes.push("Removed height utilities for hug node.");
        return;
      }

      // FILL: enforce h-full (remove bracket heights + any other h-* utilities like h-auto)
      if (mode === "fill") {
        if (!hasAnyBracketHeight && tokens.some((t) => splitToken(t).base === "h-full")) return;

        let nextTokens = stripAllHeightUtilities(tokens);
        // Ensure no bracket heights survive (already stripped, but keep explicit)
        nextTokens = nextTokens.filter((t) => !HEIGHT_TOKEN_RE.test(splitToken(t).base));
        nextTokens.push("h-full");
        nextTokens = dedupe(nextTokens);

        const before = tokens.join(" ");
        const after = nextTokens.join(" ");
        if (before === after) return;

        const attrs = { ...node.attrs };
        const order = [...node.attrOrder];
        setClassTokens(attrs, order, nextTokens);
        const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
        patches.push(createPatch(node.openStart, node.openEnd, replacement));
        changedNodes += 1;
        notes.push("Replaced height utilities with h-full for fill node.");
        return;
      }

      // FIXED: preserve bracket height. If none, do nothing.
      if (!hasAnyBracketHeight) return;

      // Start by removing all bracket heights (including responsive variants)
      let nextTokens = tokens.filter((t) => !HEIGHT_TOKEN_RE.test(splitToken(t).base));

      // Keep exactly one bracket height from the original token set
      // Prefer non-variant (plain h-[...]) if present; otherwise take first found (might be md:h-[...])
      const fixed =
        tokens.find((t) => splitToken(t).variant === "" && HEIGHT_TOKEN_RE.test(splitToken(t).base)) ||
        tokens.find((t) => HEIGHT_TOKEN_RE.test(splitToken(t).base));

      if (fixed) nextTokens.push(fixed);

      // For media nodes (img or image-ish wrappers), add max-md:h-auto if missing
      if (fixed && isMediaNode(node) && !hasMaxMdAuto(tokens)) {
        nextTokens.push("max-md:h-auto");
        notes.push("Added max-md:h-auto for fixed media height.");
      }

      nextTokens = dedupe(nextTokens);

      const before = tokens.join(" ");
      const after = nextTokens.join(" ");
      if (before === after) return;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;

      if (!isMediaNode(node)) notes.push("Preserved fixed height for fixed node.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default heightsContract;
