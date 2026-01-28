import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getNodeIdentifier,
  parseHtmlNodes,
  setAttrValue,
} from "./contractTypes.js";


function hasActionSignal(node) {
  const attrs = node.attrs || {};
  const dataKey = String(getAttrValue(attrs, "data-key") || "").toLowerCase();
  if (getAttrValue(attrs, "data-href")) return true;
  if (getAttrValue(attrs, "data-actions-openurl")) return true;
  if (getAttrValue(attrs, "data-component") === "button") return true;
  return dataKey.includes("/instance:button");
}

export const ctaContract = {
  name: "cta",
  order: 400,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;
      if (node.closeStart === null) continue;

      const isInteractive = hasActionSignal(node);
      const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
      const hasDataHref = getAttrValue(node.attrs, "data-href");
      const hasActionUrl = getAttrValue(node.attrs, "data-actions-openurl");
      const shouldLink = Boolean(hasDataHref || hasActionUrl || dataKey.includes("link"));

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];

      if (!isInteractive) {
        if (node.tag !== "div") {
          const openReplacement = buildOpenTag("div", attrs, order, false);
          patches.push(createPatch(node.openStart, node.openEnd, openReplacement));
          patches.push(createPatch(node.closeStart, node.closeEnd, "</div>"));
          changedNodes += 1;
          notes.push(`cta adjusted ${getNodeIdentifier(node)}`);
        }
        continue;
      }

      if (shouldLink) {
        if (!getAttrValue(attrs, "href")) {
          const href = hasDataHref || hasActionUrl || "#";
          setAttrValue(attrs, order, "href", href);
        }
      } else if (!getAttrValue(attrs, "type")) {
        setAttrValue(attrs, order, "type", "button");
      }

      const tagName = shouldLink ? "a" : "button";
      const openReplacement = buildOpenTag(tagName, attrs, order, false);
      const closeReplacement = `</${tagName}>`;
      patches.push(createPatch(node.openStart, node.openEnd, openReplacement));
      patches.push(createPatch(node.closeStart, node.closeEnd, closeReplacement));

      changedNodes += 1;
      notes.push(`cta adjusted ${getNodeIdentifier(node)}`);
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default ctaContract;
