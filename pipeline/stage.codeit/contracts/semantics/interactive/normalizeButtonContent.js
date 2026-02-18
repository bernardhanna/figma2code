const {
  applyPatches,
  buildOpenTag,
  createPatch,
  parseHtmlNodes,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "semantics/interactive/normalizeButtonContent";

/** Block-level / sectioning tags that are invalid inside <button> (phrasing content only). */
const BLOCK_TAGS = new Set([
  "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "header", "footer", "main", "aside", "nav",
  "figure", "figcaption", "blockquote", "pre", "address",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "form", "fieldset", "hr",
]);

const isBlockTag = (tag) =>
  BLOCK_TAGS.has(String(tag || "").toLowerCase());

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent == null) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

/** All descendant indices of nodeIndex (BFS). */
const getDescendantIndices = (childrenMap, nodeIndex) => {
  const out = [];
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    out.push(idx);
    queue.push(...(childrenMap.get(idx) || []));
  }
  return out;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let normalized = 0;

  nodes.forEach((node, nodeIndex) => {
    const tag = (node?.tag || "").toLowerCase();
    if (tag !== "button") return;
    if (node.isSelfClosing) return;

    const descendantIndices = getDescendantIndices(childrenMap, nodeIndex);
    descendantIndices.forEach((idx) => {
      const child = nodes[idx];
      if (!child || child.isSelfClosing) return;
      if (!isBlockTag(child.tag)) return;

      const newOpen = buildOpenTag(
        "span",
        child.attrs,
        child.attrOrder || Object.keys(child.attrs || {}),
        false
      );
      patches.push(createPatch(child.openStart, child.openEnd, newOpen));
      if (child.closeStart != null && child.closeEnd != null) {
        patches.push(createPatch(child.closeStart, child.closeEnd, "</span>"));
      }
      const meta = getNodeMeta(child);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "blockToSpan",
        value: `${child.tag}→span`,
        reason: "Button may only contain phrasing content",
      });
      normalized += 1;
    });
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
