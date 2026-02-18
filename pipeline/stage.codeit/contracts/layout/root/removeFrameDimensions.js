"use strict";

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

const id = "layout/root/removeFrameDimensions";

const WIDTH_TOKEN = /^(w|max-w|min-w)-/;
const HEIGHT_TOKEN = /^h-/;

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

const isDecorative = (node) => getAttrValue(node?.attrs, "data-decorative") === "1";

const hasObjectCoverOrAspect = (attrs) => {
  const tokens = getClassTokens(attrs || {});
  return tokens.some((t) => {
    const core = normalizeToken(t);
    return core === "object-cover" || core.startsWith("aspect-");
  });
};

const isExplicitMediaWrapper = (node) => {
  if (!node?.attrs) return false;
  const keys = ["data-bg-type", "data-fill-type", "data-media", "data-video-url", "data-poster-url"];
  return keys.some((key) => {
    if (!(key in node.attrs)) return false;
    const value = getAttrValue(node.attrs, key);
    if (value === null) return true;
    return String(value ?? "").trim() !== "";
  });
};

const hasLayoutChildren = (nodes, childrenMap, nodeIndex) => {
  const children = childrenMap.get(nodeIndex) || [];
  return children.some((idx) => {
    const child = nodes[idx];
    if (!child?.attrs) return false;
    const tokens = getClassTokens(child.attrs);
    return tokens.some((t) => {
      const core = normalizeToken(t);
      return core === "flex" || core === "grid";
    });
  });
};

const isFrameRootContainer = (node, nodes, childrenMap, nodeIndex) => {
  if (!node?.attrs) return false;
  if (isMediaTag(node.tag)) return false;
  if (isDecorative(node)) return false;
  if (isExplicitMediaWrapper(node)) return false;
  if (hasObjectCoverOrAspect(node.attrs)) return false;

  const tag = (node.tag || "").toLowerCase();
  const isSectionOrHeader = tag === "section" || tag === "header";
  const isTopLevelWrapper =
    tag === "div" && node.parentIndex != null && (nodes[node.parentIndex]?.tag || "").toLowerCase() === "section";
  if (!isSectionOrHeader && !isTopLevelWrapper) return false;

  const wIntent = String(getAttrValue(node.attrs, "data-w-intent") || "").trim().toLowerCase();
  if (wIntent !== "fixed" && wIntent !== "hug") return false;

  if (!hasLayoutChildren(nodes, childrenMap, nodeIndex)) return false;

  return true;
};

const shouldPreserveRootHeight = (node) => {
  if (!node?.attrs) return false;
  const dataBgType = String(getAttrValue(node.attrs, "data-bg-type") || "").toLowerCase();
  if (dataBgType === "video" || dataBgType === "image") return true;
  const role = String(getAttrValue(node.attrs, "role") || "").toLowerCase();
  if (role === "banner") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  const dataNode = String(getAttrValue(node.attrs, "data-node") || "").toLowerCase();
  if (/hero|banner/.test(dataKey) || /hero|banner/.test(dataNode)) return true;
  return false;
};

const isWidthToken = (token) => WIDTH_TOKEN.test(normalizeToken(token));
const isHeightToken = (token) => HEIGHT_TOKEN.test(normalizeToken(token));

const tokensEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/**
 * Remove Figma-derived fixed frame dimensions from section-level layout containers.
 * Applies only to frame-root containers (section/header/top-level wrapper inside section).
 * Removes width/height utilities and enforces w-full.
 * @param {{ html: string, artifact?: object, options?: object }} input
 * @returns {{ html: string, changes: array, warnings: array, stats: object }}
 */
const apply = ({ html }) => {
  const source = String(html ?? "");
  if (!source) {
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };
  }

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  let adjusted = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node?.attrs) continue;

    if (!isFrameRootContainer(node, nodes, childrenMap, i)) continue;
    const tokens = getClassTokens(node.attrs);
    const widthTokens = tokens.filter(isWidthToken);
    const hasNonFullWidth = widthTokens.some((t) => normalizeToken(t) !== "w-full");

    let out = tokens.filter((t) => {
      if (!isWidthToken(t)) return true;
      if (!hasNonFullWidth && normalizeToken(t) === "w-full") return true;
      return false;
    });

    if (!out.some((t) => normalizeToken(t) === "w-full")) {
      out.push("w-full");
    }

    if (
      !isMediaTag(node.tag) &&
      !isDecorative(node) &&
      !isExplicitMediaWrapper(node) &&
      !shouldPreserveRootHeight(node)
    ) {
      out = out.filter((t) => !isHeightToken(t));
    }

    if (tokensEqual(out, tokens)) continue;

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
      op: "removeFixedDimensions",
      value: "w-full",
      reason: "Removed fixed frame dimensions from layout root",
    });
    adjusted += 1;
  }

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings: [],
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};
