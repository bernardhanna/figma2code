import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

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

function hasGridDisplay(tokens) {
  return tokens.some((token) => splitToken(token).base === "grid");
}

function removeWidthTokens(tokens) {
  return tokens.filter((token) => {
    const { base } = splitToken(token);
    if (base === "w-full") return true;
    if (base.startsWith("w-")) return false;
    if (base.startsWith("max-w-")) return false;
    return true;
  });
}

const gridWidthsContract = {
  name: "gridWidths",
  order: 220,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length || !hasGridDisplay(tokens)) return;

      const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
      const widthRem = String(getAttrValue(node.attrs, "data-w-rem") || "").trim();
      if (intent !== "fixed" || !widthRem) return;

      let nextTokens = removeWidthTokens(tokens);
      if (!nextTokens.includes("w-full")) nextTokens.push("w-full");
      const maxWToken = `max-w-[${widthRem}]`;
      const parentIndex = node.parentIndex;
      const parentTokens =
        parentIndex !== null && parentIndex !== undefined
          ? getClassTokens(nodes[parentIndex]?.attrs)
          : [];
      const parentHasSameMaxW = parentTokens.includes(maxWToken);
      if (!parentHasSameMaxW && !nextTokens.includes(maxWToken)) nextTokens.push(maxWToken);

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Restored grid width constraint.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default gridWidthsContract;
