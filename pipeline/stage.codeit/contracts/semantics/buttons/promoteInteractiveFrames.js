const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setAttrValue,
} = require("../../utils/html");
const { getNodeMeta, isInteractiveTag } = require("../../utilities/select");

const id = "semantics/buttons/promoteInteractiveFrames";

const normalizeToken = (token) => String(token || "").split(":").pop();

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

/** Tag is div or span. */
const isDivOrSpan = (tag) => {
  const t = (tag || "").toLowerCase();
  return t === "div" || t === "span";
};

/** Class contains btn or cursor-pointer. */
const hasBtnOrCursorPointer = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  return tokens.some((t) => {
    const c = normalizeToken(t);
    return c === "btn" || /^btn[- ]/.test(c) || c === "cursor-pointer";
  });
};

/** Class has both hover:* and focus-visible:* (or focus:). */
const hasHoverAndFocusVisible = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  const hasHover = tokens.some((t) => String(t).includes("hover:"));
  const hasFocus = tokens.some((t) =>
    String(t).includes("focus-visible:") || String(t).includes("focus:")
  );
  return hasHover && hasFocus;
};

/** Looks button-like: btn/cursor-pointer OR hover+focus-visible. */
const looksButtonLike = (attrs) =>
  hasBtnOrCursorPointer(attrs) || hasHoverAndFocusVisible(attrs);

/** Has padding classes (p-*, px-*, pt-*, etc.). */
const hasPadding = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  const cores = tokens.map(normalizeToken);
  return cores.some((c) =>
    /^p-/.test(c) || /^px-/.test(c) || /^py-/.test(c) ||
    /^pt-/.test(c) || /^pb-/.test(c) || /^pl-/.test(c) || /^pr-/.test(c)
  );
};

/** Direct child indices. */
const getDirectChildren = (childrenMap, nodeIndex) =>
  childrenMap.get(nodeIndex) || [];

/** Inline text container (p, span, div). */
const isInlineTextTag = (tag) => {
  const t = (tag || "").toLowerCase();
  return t === "p" || t === "span" || t === "div";
};

/** Contains form control or link (a with href). */
const hasFormControlOrLink = (nodes, childrenMap, nodeIndex) => {
  const queue = [...getDirectChildren(childrenMap, nodeIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    const tag = (node.tag || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") return true;
    if (tag === "a") {
      const href = getAttrValue(node.attrs, "href");
      if (href != null && String(href).trim() !== "") return true;
    }
    queue.push(...getDirectChildren(childrenMap, idx));
  }
  return false;
};

/** Count interactive descendants (a, button, input, etc.). */
const countInteractiveDescendants = (nodes, childrenMap, nodeIndex) => {
  let count = 0;
  const queue = [...getDirectChildren(childrenMap, nodeIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (isInteractiveTag(node.tag)) count += 1;
    queue.push(...getDirectChildren(childrenMap, idx));
  }
  return count;
};

/** Single text node = 0 element children and inner content has no tags. */
const hasOnlyTextContent = (source, node) => {
  if (node.closeStart == null || node.closeEnd == null) return false;
  const inner = source.slice(node.openEnd, node.closeStart);
  return inner.indexOf("<") === -1 && inner.length > 0;
};

/** Single inline child (p/span/div) that is just text = exactly one child, tag p/span/div, and that child has no element children. */
const hasSingleInlineTextChild = (nodes, childrenMap, nodeIndex) => {
  const childIdxs = getDirectChildren(childrenMap, nodeIndex);
  if (childIdxs.length !== 1) return false;
  const child = nodes[childIdxs[0]];
  if (!child || !isInlineTextTag(child.tag)) return false;
  const grandchildIdxs = getDirectChildren(childrenMap, childIdxs[0]);
  return grandchildIdxs.length === 0;
};

/** High-confidence: button-like div/span with padding and single text or single inline text child. */
const isHighConfidenceButtonFrame = (node, nodes, childrenMap, nodeIndex, source) => {
  if (!node?.attrs) return false;
  if (!isDivOrSpan(node.tag)) return false;
  if (node.isSelfClosing) return false;
  if ((node.tag || "").toLowerCase() === "button" || (node.tag || "").toLowerCase() === "a") return false;
  if (!looksButtonLike(node.attrs)) return false;
  if (!hasPadding(node.attrs)) return false;
  if (hasFormControlOrLink(nodes, childrenMap, nodeIndex)) return false;
  if (countInteractiveDescendants(nodes, childrenMap, nodeIndex) > 0) return false;
  if (hasOnlyTextContent(source, node)) return true;
  if (hasSingleInlineTextChild(nodes, childrenMap, nodeIndex)) return true;
  return false;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { promoted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let promoted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!isHighConfidenceButtonFrame(node, nodes, childrenMap, nodeIndex, source)) return;

    const directChildren = getDirectChildren(childrenMap, nodeIndex);
    const singleP = directChildren.length === 1 && (nodes[directChildren[0]]?.tag || "").toLowerCase() === "p";
    const onlyText = directChildren.length === 0;

    const newAttrs = { ...node.attrs };
    const newOrder = [...(node.attrOrder || Object.keys(node.attrs || {}))];
    setAttrValue(newAttrs, newOrder, "type", "button");

    const buttonOpen = buildOpenTag("button", newAttrs, newOrder, false);
    patches.push(createPatch(node.openStart, node.openEnd, buttonOpen));
    if (node.closeStart != null && node.closeEnd != null) {
      patches.push(createPatch(node.closeStart, node.closeEnd, "</button>"));
    }

    if (singleP) {
      const pChild = nodes[directChildren[0]];
      const spanOpen = buildOpenTag(
        "span",
        pChild.attrs,
        pChild.attrOrder || Object.keys(pChild.attrs || {}),
        false
      );
      patches.push(createPatch(pChild.openStart, pChild.openEnd, spanOpen));
      if (pChild.closeStart != null && pChild.closeEnd != null) {
        patches.push(createPatch(pChild.closeStart, pChild.closeEnd, "</span>"));
      }
    }

    if (onlyText) {
      const innerContent = source.slice(node.openEnd, node.closeStart);
      const wrapped = `<span>${innerContent}</span>`;
      patches.push(createPatch(node.openEnd, node.closeStart, wrapped));
    }

    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "promoteToButton",
      value: "button type=button",
      reason: "High-confidence button-like frame promoted to semantic button",
    });
    promoted += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { promoted },
  };
};

module.exports = {
  id,
  apply,
};
