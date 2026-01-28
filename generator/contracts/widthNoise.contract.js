import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const RESPONSIVE_PARTS = new Set(["sm", "md", "lg", "xl", "2xl"]);
const BRACKET_W_RE = /^w-\[[^\]]+\]$/;

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

function isResponsiveVariant(variant) {
  if (!variant) return false;
  const parts = String(variant || "")
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => RESPONSIVE_PARTS.has(p) || p.startsWith("max-") || p.startsWith("min-"));
}

function isAllowedVariant(variant) {
  return !variant || isResponsiveVariant(variant);
}

function getLabel(node) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  const dataName = String(
    getAttrValue(node.attrs, "data-name") || getAttrValue(node.attrs, "data-node-name") || ""
  );
  return `${dataKey} ${dataName}`.toLowerCase();
}

function isDecorativeOrDivider(node) {
  if (getAttrValue(node.attrs, "data-decorative") === "1") return true;
  const label = getLabel(node);
  return label.includes("decorativebar") || label.includes("divider");
}

function isRoot(node) {
  return String(getAttrValue(node.attrs, "data-key") || "").toLowerCase() === "root";
}

function isButtonLike(tokens) {
  return tokens.includes("btn");
}

function hasDisqualifyingTokens(tokens) {
  return tokens.some((token) => {
    const { base } = splitToken(token);
    if (base.startsWith("basis-")) return true;
    if (base === "grow" || base.startsWith("grow-")) return true;
    if (base === "shrink" || base.startsWith("shrink-")) return true;
    if (base === "flex-1") return true;
    if (base === "min-w-0") return true;
    if (base.startsWith("max-w-") && base !== "max-w-full") return true;
    return false;
  });
}

function addToMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

export const widthNoiseContract = {
  name: "widthNoise",
  order: 260,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      if (node.tag === "img") return;
      if (isRoot(node)) return;

      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (isButtonLike(tokens)) return;
      if (isDecorativeOrDivider(node)) return;
      if (hasDisqualifyingTokens(tokens)) return;

      const parentIndex = node.parentIndex;
      if (parentIndex === null || parentIndex === undefined) return;
      const parent = nodes[parentIndex];
      const parentTokens = getClassTokens(parent.attrs);
      if (!parentTokens.length) return;

      const parentWidthByVariant = new Map();
      const parentMaxWFull = new Set();
      let parentHasAllowed = false;

      for (const token of parentTokens) {
        const { variant, base } = splitToken(token);
        if (!isAllowedVariant(variant)) continue;
        const key = variant || "";
        if (base.startsWith("w-")) {
          addToMap(parentWidthByVariant, key, base);
          parentHasAllowed = true;
        } else if (base === "max-w-full") {
          parentMaxWFull.add(key);
          parentHasAllowed = true;
        }
      }

      if (!parentHasAllowed) return;

      const childWidthByVariant = new Map();
      const childBracketByVariant = new Set();
      const childHasUnsafeVariant = tokens.some((token) => {
        const { variant, base } = splitToken(token);
        if (!base.startsWith("w-") && base !== "max-w-full") return false;
        if (!variant) return false;
        return !isResponsiveVariant(variant);
      });
      if (childHasUnsafeVariant) return;

      for (const token of tokens) {
        const { variant, base } = splitToken(token);
        if (!isAllowedVariant(variant)) continue;
        const key = variant || "";
        if (base.startsWith("w-")) {
          addToMap(childWidthByVariant, key, base);
          if (BRACKET_W_RE.test(base)) childBracketByVariant.add(key);
        }
      }

      const nextTokens = tokens.filter((token) => {
        const { variant, base } = splitToken(token);
        if (!isAllowedVariant(variant)) return true;
        const key = variant || "";

        if (base.startsWith("w-")) {
          const parentSet = parentWidthByVariant.get(key);
          if (parentSet && parentSet.has(base)) return false;
        }

        if (base === "max-w-full") {
          if (!parentMaxWFull.has(key)) return true;
          const widthBases = childWidthByVariant.get(key) || new Set();
          const hasBracket = childBracketByVariant.has(key);
          const onlyWFullOrNone =
            widthBases.size === 0 || (widthBases.size === 1 && widthBases.has("w-full"));
          const parentSet = parentWidthByVariant.get(key) || new Set();
          const childHasDuplicateWidth = Array.from(widthBases).some((w) => parentSet.has(w));

          if (childHasDuplicateWidth || (!hasBracket && onlyWFullOrNone)) return false;
        }

        return true;
      });

      if (nextTokens.length === tokens.length) return;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push("Removed redundant width noise.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default widthNoiseContract;
