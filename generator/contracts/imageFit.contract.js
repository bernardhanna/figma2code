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

export const imageFitContract = {
  name: "imageFit",
  order: 300,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (node.tag !== "img") continue;
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.includes("object-cover")) continue;
      if (!tokens.includes("w-full")) continue;
      if (!tokens.some((token) => /^h-\[.+\]$/.test(token))) continue;
      if (tokens.includes("max-md:object-contain")) continue;

      const nextTokens = [...tokens, "max-md:object-contain"];
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push(`imageFit adjusted ${getNodeIdentifier(node)}`);
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default imageFitContract;
