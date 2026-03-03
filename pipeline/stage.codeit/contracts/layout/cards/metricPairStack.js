const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/cards/metricPairStack";

const normalizeToken = (token) => String(token || "").split(":").pop();
const PERCENT_DECIMALS = 6;

const extractInnerText = (html, node) =>
  String(html.slice(node.openEnd, node.closeStart) || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const numberLike = (text) => /^\d[\d.,]*(?:\+|%|k\+|m\+)?$/i.test(String(text || "").trim());

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, idx) => {
    if (typeof node?.parentIndex !== "number") return;
    if (!map.has(node.parentIndex)) map.set(node.parentIndex, []);
    map.get(node.parentIndex).push(idx);
  });
  return map;
};

const isTextTag = (tag) => /^(h[1-6]|p|span)$/i.test(String(tag || ""));
const isElementNode = (node) => !!(node && node.tag && node.attrs);
const getElementChildren = (nodes, childrenMap, parentIndex) =>
  (childrenMap.get(parentIndex) || []).filter((idx) => isElementNode(nodes[idx]));

const collectLeafTextNodes = (source, nodes, childrenMap, startIndex) => {
  const out = [];
  const queue = [...(childrenMap.get(startIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const n = nodes[idx];
    if (!n) continue;
    const kids = childrenMap.get(idx) || [];
    if (isTextTag(n.tag) && kids.length === 0) {
      const text = extractInnerText(source, n);
      if (text) out.push({ idx, text });
      continue;
    }
    queue.push(...kids);
  }
  return out;
};

const findMetricPairNodes = (source, nodes, childrenMap) => {
  const out = [];
  nodes.forEach((node, idx) => {
    if (!node?.attrs) return;
    const classes = getClassTokens(node.attrs);
    if (!classes.some((t) => normalizeToken(t) === "flex")) return;
    const children = getElementChildren(nodes, childrenMap, idx);
    if (children.length !== 2) return;
    const c1 = nodes[children[0]];
    const c2 = nodes[children[1]];
    if (!isTextTag(c1?.tag) || !isTextTag(c2?.tag)) return;
    const t1 = extractInnerText(source, c1);
    const t2 = extractInnerText(source, c2);
    const texts = [
      { idx: children[0], text: t1 },
      { idx: children[1], text: t2 },
    ];
    const num = texts.find((t) => numberLike(t.text));
    if (!num) return;
    const caption = texts.find((t) => t.idx !== num.idx && String(t.text || "").trim().length >= 8);
    if (!caption) return;
    out.push({ idx });
  });
  return out;
};

const hasMetricDescendant = (metricPairs) => metricPairs.length > 0;

const buildParentMap = (nodes) => {
  const parent = new Map();
  nodes.forEach((n, idx) => {
    if (typeof n?.parentIndex === "number") parent.set(idx, n.parentIndex);
  });
  return parent;
};

const isDescendantOf = (parentMap, nodeIdx, ancestorIdx) => {
  let cur = nodeIdx;
  while (typeof cur === "number") {
    if (cur === ancestorIdx) return true;
    cur = parentMap.get(cur);
  }
  return false;
};

const subtreeMetricPairCount = (parentMap, pairIdxSet, rootIdx) => {
  let count = 0;
  for (const idx of pairIdxSet) {
    if (isDescendantOf(parentMap, idx, rootIdx)) count += 1;
  }
  return count;
};

const subtreeHasMedia = (nodes, childrenMap, rootIdx) => {
  const queue = [rootIdx];
  const seen = new Set();
  while (queue.length) {
    const idx = queue.shift();
    if (seen.has(idx)) continue;
    seen.add(idx);
    const node = nodes[idx];
    if (!node) continue;
    const tag = String(node.tag || "").toLowerCase();
    if (tag === "img" || tag === "video" || tag === "picture") return true;
    const key = String(node?.attrs?.["data-key"] || "").toLowerCase();
    if (/\b(frame:image|frame:hero|image|media|video)\b/.test(key)) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

const sanitizeMetricPairTokens = (tokens) => {
  const next = tokens.filter((t) => {
    const raw = String(t || "");
    const core = normalizeToken(t);
    if (core === "flex-row") return false;
    if (/^(md|lg|xl|2xl):flex-row$/.test(raw)) return false;
    if (/^(md|lg|xl|2xl):justify-/.test(raw)) return false;
    if (/^(md|lg|xl|2xl):items-/.test(raw)) return false;
    return true;
  });
  if (!next.some((t) => normalizeToken(t) === "flex")) next.push("flex");
  if (!next.some((t) => normalizeToken(t) === "flex-col")) next.push("flex-col");
  if (!next.some((t) => String(t) === "md:flex-col")) next.push("md:flex-col");
  if (!next.includes("md:justify-start")) next.push("md:justify-start");
  if (!next.includes("md:items-start")) next.push("md:items-start");
  return next;
};

const sanitizeMetricRowTokens = (tokens) => {
  const next = tokens.filter((t) => {
    const raw = String(t || "");
    const core = normalizeToken(t);
    if (core === "flex-row") return false;
    if (/^(md|lg|xl|2xl):flex-row$/.test(raw)) return false;
    if (/^(md|lg|xl|2xl):justify-/.test(raw)) return false;
    return true;
  });
  if (!next.some((t) => normalizeToken(t) === "flex")) next.push("flex");
  if (!next.some((t) => normalizeToken(t) === "flex-col")) next.push("flex-col");
  if (!next.includes("md:grid")) next.push("md:grid");
  if (!next.includes("md:grid-cols-3")) next.push("md:grid-cols-3");
  if (!next.includes("md:items-start")) next.push("md:items-start");
  return next;
};

const parseRemValue = (raw) => {
  const m = String(raw || "").trim().match(/^(-?\d+(?:\.\d+)?)rem$/i);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const formatPercent = (value) => {
  const fixed = Number(value).toFixed(PERCENT_DECIMALS);
  return fixed.replace(/\.?0+$/, "");
};

const computeSplitPercent = ({ childRem, rootRem, fallback }) => {
  if (Number.isFinite(childRem) && Number.isFinite(rootRem) && rootRem > 0 && childRem > 0 && childRem < rootRem) {
    return `${formatPercent((childRem / rootRem) * 100)}%`;
  }
  return fallback;
};

const applyComputedSplit = (tokens, percent) => {
  const next = tokens.filter((t) => {
    const raw = String(t || "");
    const core = normalizeToken(t);
    if (/^md:flex-1$/.test(raw)) return false;
    if (/^md:basis-/.test(raw)) return false;
    if (/^md:max-w-/.test(raw)) return false;
    if (/^md:grow/.test(raw)) return false;
    if (core === "grow" && /^md:grow$/.test(raw)) return false;
    return true;
  });
  next.push(`md:basis-[${percent}]`, `md:max-w-[${percent}]`, "md:grow-0");
  return next;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const parentMap = buildParentMap(nodes);
  const metricPairs = findMetricPairNodes(source, nodes, childrenMap);
  const pairIdxSet = new Set(metricPairs.map((m) => Number(m.idx)));
  const metricRowIdxSet = new Set(
    metricPairs
      .map((m) => nodes[m.idx]?.parentIndex)
      .filter((v) => typeof v === "number")
  );

  const patches = [];
  const changes = [];
  let adjusted = 0;

  nodes.forEach((node, idx) => {
    if (!node?.attrs) return;
    const key = String(node.attrs["data-key"] || "");
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    if (pairIdxSet.has(idx)) {
      const next = sanitizeMetricPairTokens(tokens);
      setClassTokens(node.attrs, node.attrOrder, next);
      patches.push(
        createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing))
      );
      const meta = getNodeMeta(node);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classNormalize",
        value: "flex-col md:flex-col",
        reason: "Metric number+caption pairs should stay stacked on desktop",
      });
      adjusted += 1;
      return;
    }

    if (metricRowIdxSet.has(idx)) {
      const next = sanitizeMetricRowTokens(tokens);
      setClassTokens(node.attrs, node.attrOrder, next);
      patches.push(
        createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing))
      );
      const meta = getNodeMeta(node);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classNormalize",
        value: "md:grid md:grid-cols-3",
        reason: "KPI rows should use deterministic 3-column grid at desktop",
      });
      adjusted += 1;
      return;
    }

    if (key === "root" && hasMetricDescendant(metricPairs)) {
      let next = tokens.filter((t) => {
        const raw = String(t || "");
        return !/^md:justify-start$/.test(raw) && !/^md:items-start$/.test(raw);
      });
      if (!next.includes("md:justify-center")) next.push("md:justify-center");
      if (!next.includes("md:items-center")) next.push("md:items-center");
      setClassTokens(node.attrs, node.attrOrder, next);
      patches.push(
        createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing))
      );
      const meta = getNodeMeta(node);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classNormalize",
        value: "md:justify-center md:items-center",
        reason: "Counter sections with metric pairs should center content at desktop",
      });
      adjusted += 1;

      const children = getElementChildren(nodes, childrenMap, idx);
      let textChildIdx = null;
      let textScore = -1;
      children.forEach((ci) => {
        const score = subtreeMetricPairCount(parentMap, pairIdxSet, ci);
        if (score > textScore) {
          textScore = score;
          textChildIdx = ci;
        }
      });
      const mediaChildIdx = children.find((ci) => ci !== textChildIdx && subtreeHasMedia(nodes, childrenMap, ci));
      const rootRem = parseRemValue(node.attrs?.["data-w-rem"]);
      if (typeof textChildIdx === "number" && nodes[textChildIdx]?.attrs) {
        const child = nodes[textChildIdx];
        const textRem = parseRemValue(child.attrs?.["data-w-rem"]);
        const textPercent = computeSplitPercent({ childRem: textRem, rootRem, fallback: "66.6667%" });
        const nextText = applyComputedSplit(getClassTokens(child.attrs), textPercent);
        setClassTokens(child.attrs, child.attrOrder, nextText);
        patches.push(
          createPatch(
            child.openStart,
            child.openEnd,
            buildOpenTag(child.tag, child.attrs, child.attrOrder, child.isSelfClosing)
          )
        );
        adjusted += 1;
      }
      if (typeof mediaChildIdx === "number" && nodes[mediaChildIdx]?.attrs) {
        const child = nodes[mediaChildIdx];
        const mediaRem = parseRemValue(child.attrs?.["data-w-rem"]);
        const mediaPercent = computeSplitPercent({ childRem: mediaRem, rootRem, fallback: "33.3333%" });
        const nextMedia = applyComputedSplit(getClassTokens(child.attrs), mediaPercent);
        setClassTokens(child.attrs, child.attrOrder, nextMedia);
        patches.push(
          createPatch(
            child.openStart,
            child.openEnd,
            buildOpenTag(child.tag, child.attrs, child.attrOrder, child.isSelfClosing)
          )
        );
        adjusted += 1;
      }
    }
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { adjusted },
  };
};

module.exports = { id, apply };
