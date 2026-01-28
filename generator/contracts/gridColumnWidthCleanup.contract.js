import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const TEXT_TAGS = new Set(["p", "span", "h1", "h2", "h3", "h4", "h5", "h6"]);
const LAYOUT_TAGS = new Set(["div", "section", "main", "header", "footer"]);
const CTA_TAGS = new Set(["button", "a"]);
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

function hasGrid(tokens) {
  return tokens.some((token) => splitToken(token).base === "grid");
}

function hasBracketWidth(tokens) {
  return tokens.some((token) => BRACKET_W_RE.test(splitToken(token).base));
}

function removeBracketWidths(tokens) {
  return tokens.filter((token) => !BRACKET_W_RE.test(splitToken(token).base));
}

function removeMaxWFull(tokens) {
  return tokens.filter((token) => splitToken(token).base !== "max-w-full");
}

function ancestorHasGrid(nodes, node) {
  let current = node.parentIndex;
  while (current !== null && current !== undefined) {
    const parent = nodes[current];
    const tokens = getClassTokens(parent.attrs);
    if (hasGrid(tokens)) return true;
    current = parent.parentIndex;
  }
  return false;
}

function isButtonLabel(nodes, node) {
  if (!TEXT_TAGS.has(node.tag)) return false;
  let current = node.parentIndex;
  while (current !== null && current !== undefined) {
    const parent = nodes[current];
    if (CTA_TAGS.has(parent.tag)) return true;
    current = parent.parentIndex;
  }
  return false;
}

export const gridColumnWidthCleanupContract = {
  name: "gridColumnWidthCleanup",
  order: 235,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (hasGrid(tokens)) return;
      if (!ancestorHasGrid(nodes, node)) return;

      const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
      const isText = TEXT_TAGS.has(node.tag);
      const isLayoutContainer = LAYOUT_TAGS.has(node.tag) && !isText && !isButtonLabel(nodes, node);
      const isCta = CTA_TAGS.has(node.tag) || tokens.includes("btn");

      let nextTokens = [...tokens];
      let changed = false;

      if (isText) {
        nextTokens = removeBracketWidths(nextTokens);
        nextTokens = removeMaxWFull(nextTokens);
        changed = true;
      } else if (isCta && hasBracketWidth(nextTokens)) {
        nextTokens = removeBracketWidths(nextTokens);
        nextTokens = removeMaxWFull(nextTokens);
        if (!nextTokens.some((token) => splitToken(token).base === "w-full")) {
          nextTokens.push("w-full");
        }
        changed = true;
      } else if (hasBracketWidth(nextTokens)) {
        if (intent === "fixed" && isLayoutContainer) {
          return;
        }
        nextTokens = removeBracketWidths(nextTokens);
        nextTokens = removeMaxWFull(nextTokens);
        changed = true;
      }

      if (!changed) return;
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Cleaned grid column widths.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default gridColumnWidthCleanupContract;
