import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  removeAttr,
  setClassTokens,
} from "./contractTypes.js";

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p"]);
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

function isDecorative(node) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("decorativebar")) return true;
  return String(getAttrValue(node.attrs, "data-decorative") || "") === "1";
}

function hasBgImage(tokens) {
  return tokens.some((token) => splitToken(token).base.includes("bg-[url("));
}

function ancestorMatches(nodes, node, predicate) {
  let current = node.parentIndex;
  while (current !== null && current !== undefined) {
    const parent = nodes[current];
    if (predicate(parent)) return true;
    current = parent.parentIndex;
  }
  return false;
}

function findBracketWidth(tokens) {
  for (const token of tokens) {
    const { base } = splitToken(token);
    if (BRACKET_W_RE.test(base)) return base;
  }
  return "";
}

export const containerMirrorTextWidthContract = {
  name: "containerMirrorTextWidth",
  order: 275,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!TEXT_TAGS.has(node.tag)) return;
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;

      const tokens = getClassTokens(node.attrs);
      const widthBase = findBracketWidth(tokens);
      if (!widthBase) return;

      const dataWRem = String(getAttrValue(node.attrs, "data-w-rem") || "");
      const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
      if (!dataWRem && intent !== "fixed") return;

      const parentIndex = node.parentIndex;
      if (parentIndex === null || parentIndex === undefined) return;
      const parent = nodes[parentIndex];
      const parentTokens = getClassTokens(parent.attrs);
      const parentWidthBase = findBracketWidth(parentTokens);
      const parentWRem = String(getAttrValue(parent.attrs, "data-w-rem") || "");
      const widthMatches = parentWidthBase && parentWidthBase === widthBase;
      const remMatches = dataWRem && parentWRem && dataWRem === parentWRem;
      if (!widthMatches && !remMatches) return;

      if (isDecorative(node)) return;
      if (
        ancestorMatches(nodes, node, (n) => {
          if (isDecorative(n)) return true;
          const t = getClassTokens(n.attrs);
          return hasBgImage(t);
        })
      ) {
        return;
      }

      const cleaned = tokens.filter((token) => {
        const { base } = splitToken(token);
        return base !== widthBase;
      });

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, cleaned);
      if (dataWRem && parentWRem && dataWRem === parentWRem) {
        removeAttr(attrs, order, "data-w-rem");
      }

      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Removed mirrored text width.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default containerMirrorTextWidthContract;
