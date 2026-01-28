import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  getInnerHtml,
  parseHtmlNodes,
  setAttrValue,
  setClassTokens,
} from "./contractTypes.js";

const BORDER_WIDTH_RE = /^border-\[([^\]]+)\]$/;
const BORDER_COLOR_RE = /^border-\[(#|rgba?\().+\]$/;
const WIDTH_RE = /^w-\[[^\]]+\]$/;
const PADDING_RE = /^(p|pt|pr|pb|pl|px|py)-/;
const BORDER_RE = /^border-/;

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

function normalizeInner(innerHtml) {
  return String(innerHtml || "").replace(/\s+/g, "").trim();
}

function isDecorative(node, tokens) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("decorativebar")) return true;
  return tokens.some((token) => splitToken(token).base.toLowerCase().includes("decorativebar"));
}

function isNumericish(value) {
  return /^[0-9.\s]+$/.test(value);
}

function isLengthValue(value) {
  return /(rem|px|em|%|vh|vw)$/i.test(value) || isNumericish(value);
}

function findBorderTokens(tokens) {
  let widthToken = null;
  let widthValue = null;
  let colorToken = null;
  let colorValue = null;

  tokens.forEach((token) => {
    const { base } = splitToken(token);
    const widthMatch = base.match(BORDER_WIDTH_RE);
    if (widthMatch && !widthToken) {
      const candidate = widthMatch[1];
      if (!isLengthValue(candidate)) return;
      widthToken = token;
      widthValue = candidate;
      return;
    }
    if (BORDER_COLOR_RE.test(base) && !colorToken) {
      colorToken = token;
      colorValue = base.slice("border-[".length, -1);
    }
  });

  return { widthToken, widthValue, colorToken, colorValue };
}

function hasBracketWidthToken(tokens) {
  return tokens.some((token) => {
    const { base } = splitToken(token);
    return WIDTH_RE.test(base);
  });
}

export const underlineBarContract = {
  name: "underlineBar",
  order: 420,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (node.tag !== "div") continue;
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;
      if (normalizeInner(getInnerHtml(html, node))) continue;

      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) continue;

      const { widthValue, colorValue } = findBorderTokens(tokens);
      if (!widthValue || !colorValue) continue;

      const nextTokens = [];
      for (const token of tokens) {
        const { base } = splitToken(token);
        if (PADDING_RE.test(base)) continue;
        if (BORDER_RE.test(base)) continue;
        nextTokens.push(token);
      }

      nextTokens.push(`h-[${widthValue}]`);
      nextTokens.push(`bg-[${colorValue}]`);

      if (!hasBracketWidthToken(nextTokens)) {
        const widthRem = String(getAttrValue(node.attrs, "data-w-rem") || "").trim();
        if (widthRem) nextTokens.push(`w-[${widthRem}]`);
      }

      const seen = new Set();
      const deduped = nextTokens.filter((token) => {
        if (seen.has(token)) return false;
        seen.add(token);
        return true;
      });

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      if (!getAttrValue(attrs, "data-decorative")) {
        setAttrValue(attrs, order, "data-decorative", "1");
      }
      setClassTokens(attrs, order, deduped);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Converted underline border to solid bar.");
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default underlineBarContract;
