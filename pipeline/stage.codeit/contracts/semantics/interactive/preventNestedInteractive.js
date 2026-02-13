const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  parseHtmlNodes,
  removeAttr,
} = require("../../utils/html");
const { getNodeMeta, isInteractiveTag } = require("../../utilities/select");

const id = "semantics/interactive/preventNestedInteractive";

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent === null || parent === undefined) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const hasInteractiveDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (isInteractiveTag(node.tag)) return true;
    const kids = childrenMap.get(idx) || [];
    queue.push(...kids);
  }
  return false;
};

const removeInteractiveAttrs = (node, attrsToRemove) => {
  const removed = [];
  attrsToRemove.forEach((key) => {
    if (getAttrValue(node.attrs, key) === null) return;
    removeAttr(node.attrs, node.attrOrder, key);
    removed.push(key);
  });
  return removed;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { demoted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let demoted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (!isInteractiveTag(node.tag)) return;
    if (!hasInteractiveDescendant(nodes, childrenMap, nodeIndex)) return;

    const originalTag = node.tag;
    const nextTag = "div";

    const attrsToRemove =
      originalTag === "a" ? ["href", "target", "rel"] : ["type", "form", "formaction"];

    const removedAttrs = removeInteractiveAttrs(node, attrsToRemove);

    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(nextTag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    if (!node.isSelfClosing && node.closeStart !== null && node.closeEnd !== null) {
      patches.push(createPatch(node.closeStart, node.closeEnd, `</${nextTag}>`));
    }

    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "attrAdd",
      value: `tag=${nextTag}`,
      reason: "a11y: prevented nested interactive",
    });

    removedAttrs.forEach((attr) => {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "attrRemove",
        value: attr,
        reason: "a11y: prevented nested interactive",
      });
    });

    demoted += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { demoted },
  };
};

module.exports = {
  id,
  apply,
};
