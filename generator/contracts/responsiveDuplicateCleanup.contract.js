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

export const responsiveDuplicateCleanupContract = {
  name: "responsiveDuplicateCleanup",
  order: 240,
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

      const baseTokens = new Set(
        tokens
          .map((t) => splitToken(t))
          .filter((t) => !t.variant)
          .map((t) => t.base)
      );

      const nextTokens = tokens.filter((token) => {
        const { variant, base } = splitToken(token);
        if (!variant) return true;
        if (!isResponsiveVariant(variant)) return true;
        return !baseTokens.has(base);
      });

      if (nextTokens.length === tokens.length) return;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push("Removed redundant responsive duplicates.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default responsiveDuplicateCleanupContract;
