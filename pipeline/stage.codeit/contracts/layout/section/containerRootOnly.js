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
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/section/containerRootOnly";

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

const getElementChildren = (nodes, childrenMap, nodeIndex) =>
  (childrenMap.get(nodeIndex) || []).filter((i) => nodes[i]?.tag);

const isSectionTag = (tag) => {
  const t = String(tag || "").toLowerCase();
  return t === "section" || t === "header";
};

const isContainerCandidate = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasMxAuto = cores.includes("mx-auto");
  const hasMaxW = cores.some((c) => c === "max-w-container" || /^max-w-/.test(c));
  return hasMxAuto && hasMaxW;
};

const removeContainerTokens = (tokens) =>
  tokens.filter((token) => {
    const core = normalizeToken(token);
    if (core === "mx-auto") return false;
    if (core === "max-w-container") return false;
    if (/^max-w-/.test(core)) return false;
    return true;
  });

const isExplicitlyRequired = (node) => {
  const keep = String(getAttrValue(node?.attrs, "data-keep-container") || "").trim();
  return keep === "1" || keep.toLowerCase() === "true";
};

const gatherDescendantCandidates = (nodes, childrenMap, sectionIndex) => {
  const out = [];
  const queue = [...getElementChildren(nodes, childrenMap, sectionIndex)];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) {
      queue.push(...getElementChildren(nodes, childrenMap, idx));
      continue;
    }
    const tokens = getClassTokens(node.attrs);
    if (isContainerCandidate(tokens)) out.push(idx);
    queue.push(...getElementChildren(nodes, childrenMap, idx));
  }
  return out;
};

const pickAllowedCandidate = (nodes, childrenMap, sectionIndex, candidateIndices) => {
  if (!candidateIndices.length) return null;
  const directChildren = getElementChildren(nodes, childrenMap, sectionIndex);
  for (const idx of directChildren) {
    if (candidateIndices.includes(idx)) return idx;
  }
  return candidateIndices[0];
};

const tokensEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  let normalized = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (!isSectionTag(node.tag)) return;

    const candidates = gatherDescendantCandidates(nodes, childrenMap, nodeIndex);
    if (candidates.length <= 1) return;

    const allowed = pickAllowedCandidate(nodes, childrenMap, nodeIndex, candidates);
    candidates.forEach((candidateIdx) => {
      if (candidateIdx === allowed) return;
      const candidate = nodes[candidateIdx];
      if (!candidate?.attrs) return;
      if (isExplicitlyRequired(candidate)) return;

      const tokens = getClassTokens(candidate.attrs);
      const next = removeContainerTokens(tokens);
      if (tokensEqual(tokens, next)) return;

      setClassTokens(candidate.attrs, candidate.attrOrder, next);
      patches.push(
        createPatch(
          candidate.openStart,
          candidate.openEnd,
          buildOpenTag(candidate.tag, candidate.attrs, candidate.attrOrder, candidate.isSelfClosing)
        )
      );

      const meta = getNodeMeta(candidate);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "removeNestedContainerSignature",
        value: "mx-auto/max-w-* removed",
        reason: "Container classes should appear only at section root/top-level wrapper",
      });
      normalized += 1;
    });
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
