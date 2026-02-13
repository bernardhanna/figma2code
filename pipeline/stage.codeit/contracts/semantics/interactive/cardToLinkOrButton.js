const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "semantics/interactive/cardToLinkOrButton";

const normalizeToken = (token) => String(token || "").split(":").pop();

/** True if token implies interactivity. */
const isInteractiveSignal = (token) => {
  const t = String(token || "");
  const core = normalizeToken(t);
  if (t.includes("hover:") || t.includes("focus:") || t.includes("focus-visible:") || t.includes("active:")) return true;
  if (core === "cursor-pointer" || core === "btn") return true;
  if (/^outline-/.test(core)) return true;
  if (/^ring(-|$)/.test(core) || /^ring-offset/.test(core)) return true;
  return false;
};

/** Tokens to remove from non-interactive elements. */
const isStrippableAffordance = (token) => {
  const t = String(token || "");
  const core = normalizeToken(t);
  if (core === "cursor-pointer" || core === "btn") return true;
  return false;
};

/** True if node (div) has any interactive affordance in class list. */
const hasInteractiveAffordances = (node) => {
  const tokens = getClassTokens(node.attrs || {});
  return tokens.some(isInteractiveSignal);
};

/** Remove interactive-only tokens from class list. */
const stripInteractiveTokens = (tokens) =>
  tokens.filter((t) => !isStrippableAffordance(t));

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

/** First/only direct child that is an <a> with non-empty href. */
const getSingleLinkChild = (nodes, childrenMap, nodeIndex) => {
  const children = childrenMap.get(nodeIndex);
  if (!children || children.length !== 1) return null;
  const child = nodes[children[0]];
  if (!child || (child.tag || "").toLowerCase() !== "a") return null;
  const href = getAttrValue(child.attrs, "href");
  if (href == null || String(href).trim() === "") return null;
  return child;
};

/** Whether subtree has any href (for "no href available" branch). */
const hasHrefInSubtree = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    const href = getAttrValue(node.attrs, "href");
    if (href != null && String(href).trim() !== "") return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

/** Clear evidence of click: data-action, data-click, or similar. Conservative. */
const hasClickEvidence = (node) => {
  if (!node.attrs) return false;
  const action = getAttrValue(node.attrs, "data-action");
  if (action != null && String(action).trim() !== "") return true;
  const click = getAttrValue(node.attrs, "data-click");
  if (click != null && String(click).trim() !== "") return true;
  return false;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { updated: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let updated = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node || (node.tag || "").toLowerCase() !== "div") return;
    if (node.isSelfClosing) return;
    if (!hasInteractiveAffordances(node)) return;

    const tokens = getClassTokens(node.attrs || {});
    const cleanedTokens = stripInteractiveTokens(tokens);

    const singleLink = getSingleLinkChild(nodes, childrenMap, nodeIndex);
    if (singleLink) {
      const href = getAttrValue(singleLink.attrs, "href");
      if (href != null && String(href).trim() !== "") {
        const newAttrs = { ...node.attrs };
        const newOrder = [...(node.attrOrder || [])];
        setAttrValue(newAttrs, newOrder, "href", href);
        const target = getAttrValue(singleLink.attrs, "target");
        if (target != null) setAttrValue(newAttrs, newOrder, "target", target);
        const rel = getAttrValue(singleLink.attrs, "rel");
        if (rel != null) setAttrValue(newAttrs, newOrder, "rel", rel);
        setClassTokens(newAttrs, newOrder, tokens);

        const newOpen = buildOpenTag("a", newAttrs, newOrder, false);
        patches.push(createPatch(node.openStart, node.openEnd, newOpen));
        patches.push(
          createPatch(singleLink.openStart, singleLink.openEnd, "")
        );
        if (
          singleLink.closeStart != null &&
          singleLink.closeEnd != null
        ) {
          patches.push(
            createPatch(singleLink.closeStart, singleLink.closeEnd, "")
          );
        }
        if (node.closeStart != null && node.closeEnd != null) {
          patches.push(
            createPatch(node.closeStart, node.closeEnd, "</a>")
          );
        }
        const meta = getNodeMeta(node);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "cardToLink",
          value: "hoisted href to outer",
          reason: "Card with single <a href> upgraded to link",
        });
        updated += 1;
        return;
      }
    }

    if (!hasHrefInSubtree(nodes, childrenMap, nodeIndex) && hasClickEvidence(node)) {
      const newAttrs = { ...node.attrs };
      const newOrder = [...(node.attrOrder || [])];
      setClassTokens(newAttrs, newOrder, tokens);
      const newOpen = buildOpenTag("button", newAttrs, newOrder, false);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      if (node.closeStart != null && node.closeEnd != null) {
        patches.push(
          createPatch(node.closeStart, node.closeEnd, "</button>")
        );
      }
      const meta = getNodeMeta(node);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "cardToButton",
        value: "data-action/click",
        reason: "Card with click evidence converted to button",
      });
      updated += 1;
      return;
    }

    setClassTokens(node.attrs, node.attrOrder, tokens);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "stripAffordances",
      value: "preserved state styles",
      reason: "State styles preserved on non-interactive card",
    });
    updated += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { updated },
  };
};

module.exports = {
  id,
  apply,
};
