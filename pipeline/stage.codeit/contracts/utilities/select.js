const { getAttrValue, getNodeIdentifier } = require("../utils/html");

const MEDIA_TAGS = new Set([
  "img",
  "video",
  "picture",
  "source",
  "svg",
  "canvas",
  "iframe",
  "embed",
  "object",
  "figure",
]);

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "textarea", "select", "label"]);

const escapeSelectorValue = (value) => String(value || "").replace(/"/g, '\\"');

const getNodeId = (node) =>
  getAttrValue(node?.attrs, "data-node-id") || getAttrValue(node?.attrs, "data-key") || null;

const getNodeSelector = (node) => {
  const dataNodeId = getAttrValue(node?.attrs, "data-node-id");
  if (dataNodeId) {
    return `[data-node-id="${escapeSelectorValue(dataNodeId)}"]`;
  }
  const dataKey = getAttrValue(node?.attrs, "data-key");
  if (dataKey) {
    return `[data-key="${escapeSelectorValue(dataKey)}"]`;
  }
  return "";
};

const getNodeMeta = (node) => ({
  nodeId: getNodeId(node) || getNodeIdentifier(node),
  selector: getNodeSelector(node),
});

const isTopLevel = (node, nodes = []) => {
  if (!node) return false;
  if (node.parentIndex === null || node.parentIndex === undefined) return true;
  const parent = nodes[node.parentIndex];
  return parent?.tag === "body";
};

const isMediaTag = (tag) => MEDIA_TAGS.has(String(tag || "").toLowerCase());
const isInteractiveTag = (tag) => INTERACTIVE_TAGS.has(String(tag || "").toLowerCase());

module.exports = {
  getNodeId,
  getNodeSelector,
  getNodeMeta,
  isTopLevel,
  isMediaTag,
  isInteractiveTag,
};
