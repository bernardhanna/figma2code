const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  removeAttr,
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isInteractiveTag } = require("../../utilities/select");

const id = "semantics/interactive/upgradeDivButtons";

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

/** True if class contains "btn". */
const hasBtnClass = (attrs) => {
  const cls = getAttrValue(attrs, "class");
  if (!cls) return false;
  const tokens = String(cls).split(/\s+/);
  return tokens.some((t) => normalizeToken(t) === "btn" || /^btn[- ]/.test(t) || t.includes("btn"));
};

/** True if has hover:/focus:/active: and also padding/border/bg/rounded. */
const hasStatePlusStyle = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  const cores = tokens.map(normalizeToken);
  const hasState = tokens.some(
    (t) =>
      String(t).includes("hover:") ||
      String(t).includes("focus:") ||
      String(t).includes("focus-visible:") ||
      String(t).includes("active:")
  );
  if (!hasState) return false;
  const hasPadding = cores.some((c) => /^p-/.test(c) || /^px-/.test(c) || /^py-/.test(c));
  const hasBorderOrBg = cores.some((c) => /^border/.test(c) || /^bg-/.test(c));
  const hasRounded = cores.some((c) => /^rounded/.test(c));
  return hasPadding || hasBorderOrBg || hasRounded;
};

/** True if role="button" or tabindex present. */
const hasRoleOrTabindex = (attrs) => {
  if (!attrs) return false;
  const role = getAttrValue(attrs, "role");
  if (role != null && String(role).trim() !== "") return true;
  const tabindex = getAttrValue(attrs, "tabindex");
  if (tabindex != null && String(tabindex).trim() !== "") return true;
  return false;
};

/** Node looks interactive (btn, state+style, or role/tabindex). */
const looksInteractive = (node) => {
  if (!node?.attrs) return false;
  if (hasBtnClass(node.attrs)) return true;
  if (hasStatePlusStyle(node.attrs)) return true;
  if (hasRoleOrTabindex(node.attrs)) return true;
  return false;
};

/** Not marked decorative. */
const isNotDecorative = (node) => {
  const v = getAttrValue(node?.attrs, "data-decorative");
  return v !== "1" && v !== "true";
};

/** Direct child indices. */
const getDirectChildren = (childrenMap, nodeIndex) =>
  childrenMap.get(nodeIndex) || [];

/** Heuristic: has complex nested layout (grid/flex with many children). */
const hasComplexNestedLayout = (nodes, childrenMap, nodeIndex) => {
  const queue = [...getDirectChildren(childrenMap, nodeIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const n = nodes[idx];
    if (!n?.attrs) continue;
    const tokens = getClassTokens(n.attrs);
    const cores = tokens.map(normalizeToken);
    const isLayout = cores.some((c) => c === "grid" || c === "flex" || /^grid-cols-/.test(c));
    const childCount = (childrenMap.get(idx) || []).length;
    if (isLayout && childCount >= 3) return true;
    queue.push(...getDirectChildren(childrenMap, idx));
  }
  return false;
};

/** Heuristic: content is simple — one primary text-like child or icon + text only. */
const hasSimpleContent = (nodes, childrenMap, nodeIndex) => {
  const childIdxs = getDirectChildren(childrenMap, nodeIndex);
  if (childIdxs.length === 0) return false;
  if (childIdxs.length === 1) return true;
  if (childIdxs.length === 2) {
    const tags = childIdxs.map((i) => (nodes[i]?.tag || "").toLowerCase());
    const iconLike = (t) => t === "svg" || t === "img";
    const textLike = (t) => ["span", "p", "a", "h1", "h2", "h3", "h4", "h5", "h6"].includes(t);
    return (iconLike(tags[0]) && textLike(tags[1])) || (textLike(tags[0]) && iconLike(tags[1]));
  }
  if (childIdxs.length >= 3) return false;
  return true;
};

/** First direct child that is <a> with href (any, for flatten case). */
const getSingleLinkChild = (nodes, childrenMap, nodeIndex) => {
  const children = childrenMap.get(nodeIndex);
  if (!children || children.length !== 1) return null;
  const child = nodes[children[0]];
  if (!child || (child.tag || "").toLowerCase() !== "a") return null;
  const href = getAttrValue(child.attrs, "href");
  if (href == null || String(href).trim() === "") return null;
  return child;
};

/** URL from wrapper: data-href, href, or extraction (we don't have extraction here; caller can pass artifact). */
const getLinkUrlFromWrapper = (node, artifact) => {
  const dataHref = getAttrValue(node?.attrs, "data-href");
  if (dataHref != null && String(dataHref).trim() !== "") return String(dataHref).trim();
  const href = getAttrValue(node?.attrs, "href");
  if (href != null && String(href).trim() !== "") return String(href).trim();
  const key = getAttrValue(node?.attrs, "data-key");
  if (key && /link|cta/i.test(String(key)) && artifact?.links?.[key]) {
    const url = artifact.links[key];
    if (url != null && String(url).trim() !== "") return String(url).trim();
  }
  return null;
};

/** Subtree has visible text (best-effort: has text-like tag). */
const hasTextLikeChild = (nodes, childrenMap, nodeIndex) => {
  const textTags = new Set(["span", "p", "a", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const queue = [...getDirectChildren(childrenMap, nodeIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const n = nodes[idx];
    if (!n) continue;
    if (textTags.has((n.tag || "").toLowerCase())) return true;
    queue.push(...getDirectChildren(childrenMap, idx));
  }
  return false;
};

/** Subtree has icon-like element (svg, img). */
const hasIconChild = (nodes, childrenMap, nodeIndex) => {
  const queue = [...getDirectChildren(childrenMap, nodeIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const n = nodes[idx];
    if (!n) continue;
    const t = (n.tag || "").toLowerCase();
    if (t === "svg" || t === "img") return true;
    queue.push(...getDirectChildren(childrenMap, idx));
  }
  return false;
};

/** True if node qualifies as button-like wrapper. */
const isButtonLikeWrapper = (node, nodes, childrenMap, nodeIndex) => {
  if (!node?.attrs) return false;
  if (!isDivOrSpan(node.tag)) return false;
  if (node.isSelfClosing) return false;
  if (isInteractiveTag(node.tag)) return false;
  const tag = (node.tag || "").toLowerCase();
  if (tag === "a" || tag === "button") return false;
  if (!looksInteractive(node)) return false;
  if (!isNotDecorative(node)) return false;
  if (hasComplexNestedLayout(nodes, childrenMap, nodeIndex)) return false;
  if (!hasSimpleContent(nodes, childrenMap, nodeIndex)) return false;
  return true;
};

const apply = ({ html, artifact = {} }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { upgraded: 0, fallback: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let upgraded = 0;
  let fallback = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!isButtonLikeWrapper(node, nodes, childrenMap, nodeIndex)) return;

    const singleLink = getSingleLinkChild(nodes, childrenMap, nodeIndex);
    const wrapperUrl = getLinkUrlFromWrapper(node, artifact);

    // B) Promote to <a> when safe: single child <a> or wrapper has URL
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

        const newOpen = buildOpenTag("a", newAttrs, newOrder, false);
        patches.push(createPatch(node.openStart, node.openEnd, newOpen));
        if (node.closeStart != null && node.closeEnd != null) {
          patches.push(createPatch(node.closeStart, node.closeEnd, "</a>"));
        }

        const spanAttrs = { ...singleLink.attrs };
        const spanOrder = [...(singleLink.attrOrder || [])];
        removeAttr(spanAttrs, spanOrder, "href");
        removeAttr(spanAttrs, spanOrder, "target");
        removeAttr(spanAttrs, spanOrder, "rel");
        const spanOpen = buildOpenTag("span", spanAttrs, spanOrder, false);
        patches.push(createPatch(singleLink.openStart, singleLink.openEnd, spanOpen));
        if (singleLink.closeStart != null && singleLink.closeEnd != null) {
          patches.push(createPatch(singleLink.closeStart, singleLink.closeEnd, "</span>"));
        }

        const meta = getNodeMeta(node);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "upgradeToLink",
          value: "flatten inner <a> to <span>",
          reason: "Button-like wrapper with single <a> child upgraded to link, inner to span",
        });
        upgraded += 1;
        return;
      }
    }

    if (wrapperUrl) {
      const newAttrs = { ...node.attrs };
      const newOrder = [...(node.attrOrder || [])];
      setAttrValue(newAttrs, newOrder, "href", wrapperUrl);
      const newOpen = buildOpenTag("a", newAttrs, newOrder, false);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      if (node.closeStart != null && node.closeEnd != null) {
        patches.push(createPatch(node.closeStart, node.closeEnd, "</a>"));
      }
      const meta = getNodeMeta(node);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "upgradeToLink",
        value: "data-href/data-key link",
        reason: "Button-like wrapper with link URL upgraded to <a>",
      });
      upgraded += 1;
      return;
    }

    // A) Default to <button type="button">
    const newAttrs = { ...node.attrs };
    const newOrder = [...(node.attrOrder || [])];
    setAttrValue(newAttrs, newOrder, "type", "button");
    if (!hasTextLikeChild(nodes, childrenMap, nodeIndex) && hasIconChild(nodes, childrenMap, nodeIndex)) {
      if (!getAttrValue(newAttrs, "aria-label")) {
        setAttrValue(newAttrs, newOrder, "aria-label", "Button");
      }
    }

    const newOpen = buildOpenTag("button", newAttrs, newOrder, false);
    patches.push(createPatch(node.openStart, node.openEnd, newOpen));
    if (node.closeStart != null && node.closeEnd != null) {
      patches.push(createPatch(node.closeStart, node.closeEnd, "</button>"));
    }
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "upgradeToButton",
      value: "button type=button",
      reason: "Button-like div/span converted to semantic button",
    });
    upgraded += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { upgraded, fallback },
  };
};

module.exports = {
  id,
  apply,
};
