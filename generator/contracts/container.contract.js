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

function isBaseToken(token) {
  return !token.includes(":");
}

function hasMaxWidth(tokens) {
  return tokens.some((token) => token.startsWith("max-w-"));
}

function hasFixedWidth(tokens) {
  return tokens.some((token) => /^w-\[.+\]$/.test(token));
}

function hasGridOrFlex(tokens) {
  return tokens.some((token) => {
    const base = token.split(":").pop();
    return base === "grid" || base === "flex" || base.startsWith("grid-") || base.startsWith("flex-");
  });
}

function hasBaseMxToken(tokens) {
  return tokens.some((token) => isBaseToken(token) && token.startsWith("mx-"));
}

function hasAnyPxToken(tokens) {
  return tokens.some((token) => token.includes("px-"));
}

function hasBasePxBracket(tokens) {
  return tokens.some((token) => isBaseToken(token) && /^px-\[.+\]$/.test(token));
}

function isTopLevelContainer(nodes, node, tokens) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (dataKey === "root") return true;

  const parent = node.parentIndex !== null ? nodes[node.parentIndex] : null;
  if (parent && parent.tag === "section") return true;

  if (!hasMaxWidth(tokens)) return false;
  if (!hasGridOrFlex(tokens)) return false;

  let current = node.parentIndex;
  while (current !== null && current !== undefined) {
    const ancestor = nodes[current];
    if (ancestor.tag === "section") return true;
    const ancestorTokens = getClassTokens(ancestor.attrs);
    if (hasGridOrFlex(ancestorTokens)) return false;
    current = ancestor.parentIndex;
  }

  return false;
}

export const containerContract = {
  name: "container",
  order: 100,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;
      const tokens = getClassTokens(node.attrs);
      const hasWFull = tokens.includes("w-full");
      const hasMaxW = hasMaxWidth(tokens);
      if (!hasWFull || !hasMaxW) continue;

      let nextTokens = [...tokens];
      let changed = false;

      if (!hasBaseMxToken(nextTokens)) {
        nextTokens.push("mx-auto");
        changed = true;
      }

      if (hasFixedWidth(nextTokens)) {
        nextTokens = nextTokens.filter((token) => !/^w-\[.+\]$/.test(token));
        changed = true;
      }

      if (
        hasMaxW &&
        hasAnyPxToken(nextTokens) &&
        !nextTokens.includes("max-xl:px-5") &&
        !hasBasePxBracket(nextTokens) &&
        isTopLevelContainer(nodes, node, nextTokens)
      ) {
        nextTokens.push("max-xl:px-5");
        changed = true;
      }

      if (!changed) continue;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push(`container adjusted ${getNodeIdentifier(node)}`);
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default containerContract;
