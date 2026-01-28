import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const BG_POSITION_TOKENS = new Set([
  "bg-center",
  "bg-left",
  "bg-right",
  "bg-top",
  "bg-bottom",
]);

const BG_IMAGE_HINTS = new Set(["bg-cover", "bg-contain", "bg-no-repeat"]);

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

function isButtonLike(tokens) {
  return tokens.includes("btn");
}

function hasBgImageToken(tokens) {
  return tokens.some((token) => {
    const { base } = splitToken(token);
    if (BG_IMAGE_HINTS.has(base)) return true;
    if (base.startsWith("bg-[url(")) return true;
    if (base.startsWith("bg-[image:")) return true;
    return false;
  });
}

export const bgPositionCleanupContract = {
  name: "bgPositionCleanup",
  order: 245,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      if (node.tag === "img") return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (isButtonLike(tokens)) return;
      if (isDecorativeOrDivider(node)) return;

      if (hasBgImageToken(tokens)) return;

      const nextTokens = tokens.filter((token) => {
        const { base } = splitToken(token);
        return !BG_POSITION_TOKENS.has(base);
      });

      if (nextTokens.length === tokens.length) return;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push("Removed unused background position utilities.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default bgPositionCleanupContract;
