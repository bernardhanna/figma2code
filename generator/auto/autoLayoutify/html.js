// generator/auto/autoLayoutify/html.js
import { escAttr } from "./escape.js";

export function openTag(tag, classes = "", attrs = {}, node) {
  const nodeId = node?.id ? ` data-node-id="${node.id}"` : "";
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");

  return `<${tag}${nodeId}${attrStr}${classes ? ` class="${classes}"` : ""}>`;
}

export function attrsForNode(node, extra = "") {
  const dn = node?.id ? ` data-node="${escAttr(node.id)}"` : "";
  return dn + (extra || "");
}
