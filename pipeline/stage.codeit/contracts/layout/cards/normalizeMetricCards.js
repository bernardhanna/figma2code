const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/cards/normalizeMetricCards";

const CONTAINER_TAGS = new Set(["div", "article", "section"]);
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span"]);
const SIZE_SCALE = {
  "text-xs": 12,
  "text-sm": 14,
  "text-base": 16,
  "text-lg": 18,
  "text-xl": 20,
  "text-2xl": 24,
  "text-3xl": 30,
  "text-4xl": 36,
  "text-5xl": 48,
  "text-6xl": 60,
  "text-7xl": 72,
  "text-8xl": 96,
  "text-9xl": 128,
};

const normalizeToken = (token) => String(token || "").split(":").pop();
const tokenPrefix = (token) => {
  const parts = String(token || "").split(":");
  return parts.length <= 1 ? "" : parts.slice(0, -1).join(":");
};

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

const extractInnerText = (html, node) => {
  if (!node || node.closeStart == null) return "";
  return String(html.slice(node.openEnd, node.closeStart) || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
};

const parseFontSizePx = (tokens) => {
  for (const token of tokens) {
    const core = normalizeToken(token);
    if (SIZE_SCALE[core]) return SIZE_SCALE[core];
    const rem = core.match(/^text-\[([0-9.]+)rem\]$/);
    if (rem) return Number(rem[1]) * 16;
    const px = core.match(/^text-\[([0-9.]+)px\]$/);
    if (px) return Number(px[1]);
  }
  return null;
};

const parseFontWeight = (tokens) => {
  let weight = 400;
  tokens.forEach((token) => {
    const core = normalizeToken(token);
    const m = core.match(/^font-\[([0-9]{3})\]$/);
    if (m) weight = Math.max(weight, Number(m[1]));
    if (core === "font-semibold") weight = Math.max(weight, 600);
    if (core === "font-bold") weight = Math.max(weight, 700);
    if (core === "font-extrabold") weight = Math.max(weight, 800);
    if (core === "font-black") weight = Math.max(weight, 900);
  });
  return weight;
};

const numberPattern = /^\s*(>|<|≈)?\s*\d+(\.\d+)?\s*$/;
const numberSymbolPattern = /^\s*[><≈]\s*\d+/;

const findMetricCards = (source, nodes, childrenMap) => {
  const cards = [];
  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (!CONTAINER_TAGS.has(String(node.tag || "").toLowerCase())) return;
    const cardTokens = getClassTokens(node.attrs);
    if (!cardTokens.some((t) => normalizeToken(t) === "flex")) return;

    const leaves = [];
    const queue = [...(childrenMap.get(nodeIndex) || [])];
    while (queue.length) {
      const idx = queue.shift();
      const child = nodes[idx];
      if (!child?.attrs) continue;
      const kids = childrenMap.get(idx) || [];
      if (TEXT_TAGS.has(String(child.tag || "").toLowerCase()) && kids.length === 0) {
        const text = extractInnerText(source, child);
        if (text) {
          const tokens = getClassTokens(child.attrs);
          leaves.push({
            nodeIndex: idx,
            node: child,
            text,
            len: text.length,
            tokens,
            sizePx: parseFontSizePx(tokens),
            weight: parseFontWeight(tokens),
          });
        }
      }
      queue.push(...kids);
    }
    if (leaves.length < 3) return;
    const numberNodes = leaves
      .filter((x) => numberPattern.test(x.text) || numberSymbolPattern.test(x.text))
      .filter((x) => Number(x.sizePx || 0) > 0)
      .sort((a, b) => Number(b.sizePx || 0) - Number(a.sizePx || 0));
    if (!numberNodes.length) return;
    const dominantNumber = numberNodes[0];
    const otherSizes = leaves
      .filter((x) => x.nodeIndex !== dominantNumber.nodeIndex && Number(x.sizePx || 0) > 0)
      .map((x) => Number(x.sizePx))
      .sort((a, b) => b - a);
    const nextSize = otherSizes[0] || 0;
    if (nextSize > 0 && Number(dominantNumber.sizePx || 0) < nextSize * 2.5) return;
    if (Number(dominantNumber.weight || 0) < 600) return;

    const title = leaves.find(
      (x) =>
        x.nodeIndex !== dominantNumber.nodeIndex &&
        x.len <= 40 &&
        Number(x.sizePx || 0) > 0 &&
        Number(x.sizePx || 0) <= Number(dominantNumber.sizePx || 0) * 0.4
    );
    const paragraph = leaves.find(
      (x) =>
        x.nodeIndex !== dominantNumber.nodeIndex &&
        x.len >= 60 &&
        Number(x.sizePx || 0) > 0 &&
        Number(x.sizePx || 0) <= Number(dominantNumber.sizePx || 0) * 0.65
    );
    if (!title || !paragraph) return;
    cards.push({ cardIndex: nodeIndex, dominantNumber, paragraph });
  });
  return cards;
};

const addToken = (tokens, token) => {
  if (!tokens.includes(token)) tokens.push(token);
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const cards = findMetricCards(source, nodes, childrenMap);
  const patches = [];
  const changes = [];
  let adjusted = 0;

  cards.forEach(({ cardIndex, dominantNumber, paragraph }) => {
    const card = nodes[cardIndex];
    const cardTokens = getClassTokens(card.attrs).filter((token) => {
      const raw = String(token || "");
      const core = normalizeToken(token);
      if (core === "flex-row") return false;
      if (/^(md|lg|xl|2xl):flex-row$/.test(raw)) return false;
      return true;
    });
    addToken(cardTokens, "flex");
    addToken(cardTokens, "flex-col");
    addToken(cardTokens, "items-center");
    addToken(cardTokens, "text-center");
    setClassTokens(card.attrs, card.attrOrder, cardTokens);
    patches.push(
      createPatch(
        card.openStart,
        card.openEnd,
        buildOpenTag(card.tag, card.attrs, card.attrOrder, card.isSelfClosing)
      )
    );
    const cardMeta = getNodeMeta(card);
    changes.push({
      contractId: id,
      nodeId: cardMeta.nodeId,
      selector: cardMeta.selector,
      op: "classNormalize",
      value: "flex-col items-center text-center",
      reason: "Metric cards should stack vertically internally at all breakpoints",
    });
    adjusted += 1;

    const paraNode = nodes[paragraph.nodeIndex];
    const paraTokens = getClassTokens(paraNode.attrs).filter((t) => !/^max-w-/.test(normalizeToken(t)));
    addToken(paraTokens, "w-full");
    addToken(paraTokens, "max-w-[20rem]");
    setClassTokens(paraNode.attrs, paraNode.attrOrder, paraTokens);
    patches.push(
      createPatch(
        paraNode.openStart,
        paraNode.openEnd,
        buildOpenTag(paraNode.tag, paraNode.attrs, paraNode.attrOrder, paraNode.isSelfClosing)
      )
    );
    const paraMeta = getNodeMeta(paraNode);
    changes.push({
      contractId: id,
      nodeId: paraMeta.nodeId,
      selector: paraMeta.selector,
      op: "classNormalize",
      value: "w-full max-w-[20rem]",
      reason: "Clamp metric paragraph width while preserving centered layout",
    });
    adjusted += 1;

    const numberParentIndex = dominantNumber.node.parentIndex;
    if (numberParentIndex != null && nodes[numberParentIndex]?.attrs) {
      const numberParent = nodes[numberParentIndex];
      const numberParentTokens = getClassTokens(numberParent.attrs);
      const colorToken =
        numberParentTokens.find((t) => /^border-\[/.test(normalizeToken(t))) ||
        numberParentTokens.find((t) => /^border-b-\[/.test(normalizeToken(t)));
      const nextNumberParent = numberParentTokens.filter((t) => {
        const core = normalizeToken(t);
        if (/^border/.test(core)) return false;
        if (core === "flex-row") return false;
        if (/^(md|lg|xl|2xl):flex-row$/.test(String(t))) return false;
        return true;
      });
      addToken(nextNumberParent, "flex");
      addToken(nextNumberParent, "flex-col");
      addToken(nextNumberParent, "justify-center");
      addToken(nextNumberParent, "items-center");
      addToken(nextNumberParent, "pt-4");
      addToken(nextNumberParent, "border-b-8");
      addToken(nextNumberParent, "border-solid");
      if (colorToken) addToken(nextNumberParent, `border-b-[${normalizeToken(colorToken).replace(/^border(?:-b)?-\[/, "").replace(/\]$/, "")}]`);
      setClassTokens(numberParent.attrs, numberParent.attrOrder, nextNumberParent);
      patches.push(
        createPatch(
          numberParent.openStart,
          numberParent.openEnd,
          buildOpenTag(
            numberParent.tag,
            numberParent.attrs,
            numberParent.attrOrder,
            numberParent.isSelfClosing
          )
        )
      );
      const numberParentMeta = getNodeMeta(numberParent);
      changes.push({
        contractId: id,
        nodeId: numberParentMeta.nodeId,
        selector: numberParentMeta.selector,
        op: "classNormalize",
        value: "border-b-8 underline",
        reason: "Render KPI accent as underline bar instead of border box around number",
      });
      adjusted += 1;
    }
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};

