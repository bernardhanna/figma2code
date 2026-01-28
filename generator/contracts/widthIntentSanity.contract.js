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

const BRACKET_W_RE = /^w-\[[^\]]+\]$/;
const MAX_W_FULL = "max-w-full";
const MAX_W_BRACKET_RE = /^max-w-\[[^\]]+\]$/;

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

export const widthIntentSanityContract = {
  name: "widthIntentSanity",
  order: 265,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (node.tag === "img" || node.tag === "svg") continue;
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;

      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) continue;
      if (hasBgImage(tokens)) continue;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      let nextTokens = [...tokens];
      let changed = false;

      if (isDecorative(node)) {
        if (getAttrValue(attrs, "data-w-rem")) {
          removeAttr(attrs, order, "data-w-rem");
          changed = true;
        }

        const cleaned = nextTokens.filter((token) => {
          const { base } = splitToken(token);
          if (base === MAX_W_FULL) return false;
          if (MAX_W_BRACKET_RE.test(base)) return false;
          return true;
        });
        if (cleaned.length !== nextTokens.length) {
          nextTokens = cleaned;
          changed = true;
        }
      } else if (String(getAttrValue(attrs, "data-w-intent") || "").toLowerCase() === "fill") {
        if (getAttrValue(attrs, "data-w-rem")) {
          removeAttr(attrs, order, "data-w-rem");
          changed = true;
        }

        const cleaned = nextTokens.filter((token) => {
          const { base } = splitToken(token);
          return !BRACKET_W_RE.test(base);
        });
        if (cleaned.length !== nextTokens.length) {
          nextTokens = cleaned;
          changed = true;
        }

        if (!nextTokens.some((token) => splitToken(token).base === "w-full")) {
          nextTokens.push("w-full");
          changed = true;
        }
      }

      if (!changed) continue;
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Normalized width intent invariants.");
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default widthIntentSanityContract;
