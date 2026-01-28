import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  getNodeIdentifier,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

function dedupeTokens(tokens) {
  const seen = new Set();
  const output = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    output.push(token);
  }
  return output;
}

function shouldKeepHeight(node, tokens) {
  if (node.tag === "img") return true;
  if (node.tag === "hr") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("/instance:decorativebar")) return true;
  if (tokens.some((token) => token.includes("bg-[url("))) return true;
  if (dataKey === "root") return true;
  return false;
}

export const sizingContract = {
  name: "sizing",
  order: 200,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;
      const tokens = getClassTokens(node.attrs);
      let nextTokens = dedupeTokens(tokens);
      let changed = nextTokens.length !== tokens.length;

      if (!shouldKeepHeight(node, nextTokens)) {
        const filtered = nextTokens.filter((token) => !/^h-\[.+\]$/.test(token));
        if (filtered.length !== nextTokens.length) {
          nextTokens = filtered;
          changed = true;
        }
      }

      if (!changed) continue;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push(`sizing adjusted ${getNodeIdentifier(node)}`);
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default sizingContract;
