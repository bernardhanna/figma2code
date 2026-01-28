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

function isLayoutContainer(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    return base === "grid" || base === "flex" || base.startsWith("grid-") || base.startsWith("flex-");
  });
}

function parentConstrainsWidth(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    if (BRACKET_W_RE.test(base)) return true;
    return base.startsWith("max-w-") && base !== "max-w-full";
  });
}

function removeBracketWidths(tokens) {
  return tokens.filter((token) => !BRACKET_W_RE.test(splitToken(token).base));
}

export const widthHygieneContract = {
  name: "widthHygiene",
  order: 999,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (isLayoutContainer(tokens)) return;

      const isText = TEXT_TAGS.has(node.tag);
      const isInnerWrapper = node.tag === "div" && !isLayoutContainer(tokens);
      if (!isText && !isInnerWrapper) return;

      const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
      if (intent === "fixed") return;

      const parentIndex = node.parentIndex;
      if (parentIndex === null || parentIndex === undefined) return;
      const parent = nodes[parentIndex];
      const parentTokens = getClassTokens(parent.attrs);
      if (!parentConstrainsWidth(parentTokens)) return;

      let nextTokens = [...tokens];
      let changed = false;

      const cleaned = removeBracketWidths(nextTokens);
      if (cleaned.length !== nextTokens.length) {
        nextTokens = cleaned;
        changed = true;
      }

      if (nextTokens.includes("max-w-full")) {
        nextTokens = nextTokens.filter((token) => token !== "max-w-full");
        changed = true;
      }

      if (!changed) return;
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Applied width hygiene cleanup.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default widthHygieneContract;
