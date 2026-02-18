const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "layout/width/innerWrapperFixedWidthToMax";

const WRAPPER_TAGS = new Set([
  "div",
  "section",
  "header",
  "article",
  "a",
  "button",
  "li",
]);

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

const isRootContainer = (node) => {
  const dataKey = String(node.attrs?.["data-key"] || "");
  if (dataKey === "root") return true;
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  const hasMax = cores.includes("max-w-[80rem]");
  const hasMxAuto = cores.includes("mx-auto");
  return hasMax && hasMxAuto;
};

const isScrollableTrack = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some(
    (c) =>
      /^overflow-x-/.test(c) ||
      c === "whitespace-nowrap" ||
      /^snap-/.test(c) ||
      /^scroll-/.test(c)
  );
};

const hasAbsoluteLike = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some(
    (c) =>
      c === "absolute" ||
      c === "fixed" ||
      /^inset-/.test(c) ||
      /^left-/.test(c) ||
      /^right-/.test(c) ||
      /^top-/.test(c) ||
      /^bottom-/.test(c)
  );
};

const hasResponsiveAncestor = (nodes, childrenMap, nodeIndex) => {
  let current = nodes[nodeIndex]?.parentIndex;
  while (current != null) {
    const node = nodes[current];
    const tokens = getClassTokens(node.attrs || {});
    const cores = tokens.map(normalizeToken);
    if (cores.includes("flex") || cores.includes("grid")) return true;
    if (cores.some((c) => /^grid-cols-/.test(c))) return true;
    current = node.parentIndex;
  }
  return false;
};

const hasDecorativeAncestor = (nodes, nodeIndex) => {
  let current = nodes[nodeIndex]?.parentIndex;
  while (current != null) {
    const attrs = nodes[current]?.attrs || {};
    const decorative = String(getAttrValue(attrs, "data-decorative") || "").trim().toLowerCase();
    if (decorative === "1" || decorative === "true") return true;
    current = nodes[current]?.parentIndex;
  }
  return false;
};

const hasMediaDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (isMediaTag(node.tag)) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

const isMediaWrapper = (node, nodes, childrenMap, nodeIndex) => {
  if (!hasMediaDescendant(nodes, childrenMap, nodeIndex)) return false;
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  const hasOverflowHidden = cores.includes("overflow-hidden");
  const hasObject = cores.some((c) => /^object-/.test(c));
  return hasOverflowHidden || hasObject;
};

const isFluidizableMediaWrapper = (node, nodes, childrenMap, nodeIndex) => {
  if (!isMediaWrapper(node, nodes, childrenMap, nodeIndex)) return false;
  const children = childrenMap.get(nodeIndex) || [];
  const mediaChildren = children.filter((idx) => isMediaTag(nodes[idx]?.tag));
  if (mediaChildren.length !== 1 || children.length !== 1) return false;
  const intent = String(getAttrValue(node?.attrs || {}, "data-w-intent") || "").toLowerCase().trim();
  if (intent === "fixed" || intent === "hug") return true;
  const tokens = getClassTokens(node?.attrs || {});
  return tokens.some((t) => !String(t).includes(":") && /^w-\[\d/.test(normalizeToken(t)));
};

const getBaseFixedWidthTokens = (tokens) =>
  tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      if (String(t).includes(":")) return false;
      const c = normalizeToken(t);
      return /^w-\[\d/.test(c) && c.endsWith("]");
    });

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tag = (node.tag || "").toLowerCase();
    if (!WRAPPER_TAGS.has(tag)) return;
    if (isMediaTag(tag)) return;

    const tokens = getClassTokens(node.attrs || {});
    if (!tokens.length) return;
    if (isRootContainer(node)) return;
    if (hasDecorativeAncestor(nodes, nodeIndex)) return;
    if (!hasResponsiveAncestor(nodes, childrenMap, nodeIndex)) return;
    if (isScrollableTrack(tokens)) return;
    if (hasAbsoluteLike(tokens)) return;
    const mediaWrapper = isMediaWrapper(node, nodes, childrenMap, nodeIndex);
    if (mediaWrapper && !isFluidizableMediaWrapper(node, nodes, childrenMap, nodeIndex)) return;

    const fixedTokens = getBaseFixedWidthTokens(tokens);
    if (!fixedTokens.length) return;
    const target = fixedTokens[fixedTokens.length - 1];
    const widthCore = normalizeToken(target.t);
    const maxWToken = widthCore.replace(/^w-/, "max-w-");

    const hasWFull = tokens.some((t) => normalizeToken(t) === "w-full");
    const hasMaxW = tokens.some((t) => normalizeToken(t) === maxWToken);
    const hasMaxWFull = tokens.some((t) => normalizeToken(t) === "max-w-full");

    let out = tokens.filter(
      (t) =>
        !(
          !String(t).includes(":") &&
          /^w-\[\d/.test(normalizeToken(t)) &&
          normalizeToken(t).endsWith("]")
        )
    );

    if (hasWFull) {
      if (!hasMaxW) {
        const idx = out.findIndex((t) => normalizeToken(t) === "w-full");
        const insertAt = idx >= 0 ? idx + 1 : out.length;
        out.splice(insertAt, 0, maxWToken);
      }
    } else {
      const insertAt = Math.min(target.i, out.length);
      out.splice(insertAt, 0, "w-full");
      if (!hasMaxW) {
        out.splice(insertAt + 1, 0, maxWToken);
      }
    }

    if (tokens.some((t) => normalizeToken(t) === "max-w-full") && !out.some((t) => normalizeToken(t) === "max-w-full")) {
      out.push("max-w-full");
    }

    setClassTokens(node.attrs, node.attrOrder, out);
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
      op: "widthNormalize",
      value: "w-[X] -> w-full max-w-[X]",
      reason: "Fixed width made responsive for inner wrapper",
    });
    adjusted += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};
