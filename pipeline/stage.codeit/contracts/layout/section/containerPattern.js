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

const id = "layout/section/containerPattern";

const SECTION_TAGS = new Set(["section", "header"]);
const MAX_W_TOKEN = /^max-w-/;
const WIDTH_TOKEN = /^w-/;
const PADDING_OR_BG = /^(p-|px-|py-|pt-|pb-|pl-|pr-|bg-)/;

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

const tokensEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const dedupeByCore = (tokens) => {
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    const core = normalizeToken(token);
    if (seen.has(core)) continue;
    seen.add(core);
    out.push(token);
  }
  return out;
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
  return keys.some((key) => key in node.attrs && String(getAttrValue(node.attrs, key) ?? "").trim() !== "");
};

const isMediaLikeNode = (node) =>
  isMediaTag(node?.tag) || isExplicitMediaWrapper(node) || hasObjectCoverOrAspect(node?.attrs);

const isMediaOnlyRoot = (nodes, childrenMap, nodeIndex) => {
  const children = getElementChildren(nodes, childrenMap, nodeIndex);
  if (!children.length) return false;
  return children.every((idx) => isMediaLikeNode(nodes[idx]));
};

const hasPaddingOrBg = (tokens) => tokens.some((t) => PADDING_OR_BG.test(normalizeToken(t)));

const hasLayoutChild = (nodes, childrenMap, nodeIndex) => {
  const children = getElementChildren(nodes, childrenMap, nodeIndex);
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

const hasInnerContainerChild = (nodes, childrenMap, nodeIndex) => {
  const children = getElementChildren(nodes, childrenMap, nodeIndex);
  for (const idx of children) {
    const child = nodes[idx];
    if (!child?.attrs) continue;
    const tokens = getClassTokens(child.attrs);
    const cores = tokens.map(normalizeToken);
    const hasMaxW = cores.some((c) => MAX_W_TOKEN.test(c));
    const hasMxAuto = cores.includes("mx-auto");
    if (hasMaxW && hasMxAuto) return idx;
  }
  return null;
};

const getMaxWidthTokens = (tokens) =>
  tokens.filter((t) => {
    const core = normalizeToken(t);
    return MAX_W_TOKEN.test(core) && core !== "max-w-full";
  });

const parseMaxWValue = (token) => {
  const core = normalizeToken(token);
  if (!core.startsWith("max-w-")) return null;
  const bracketMatch = core.match(/^max-w-\[(.+)\]$/);
  if (bracketMatch) {
    const raw = bracketMatch[1].trim();
    const match = raw.match(/^(\d+(\.\d+)?)(px|rem|em|%)?$/);
    if (!match) return null;
    let value = parseFloat(match[1]);
    const unit = match[3] || "px";
    if (unit === "rem" || unit === "em") value *= 16;
    return value;
  }
  const screenMatch = core.match(/^max-w-screen-(sm|md|lg|xl|2xl)$/);
  if (screenMatch) {
    const sizes = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
    return sizes[screenMatch[1]] || null;
  }
  const scaleMatch = core.match(/^max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)$/);
  if (scaleMatch) {
    const order = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"];
    return order.indexOf(scaleMatch[1]);
  }
  return null;
};

const pickLargestMaxW = (tokens) => {
  if (!tokens.length) return null;
  let best = null;
  let bestValue = null;
  for (const token of tokens) {
    const value = parseMaxWValue(token);
    if (value == null) {
      if (!best) best = token;
      continue;
    }
    if (bestValue == null || value > bestValue) {
      best = token;
      bestValue = value;
    }
  }
  return best;
};

const hasMaxWContainerToken = (nodes) =>
  nodes.some((node) => {
    if (!node?.attrs) return false;
    const tokens = getClassTokens(node.attrs);
    return tokens.some((t) => normalizeToken(t) === "max-w-container");
  });

const isMultiColumnGrid = (tokens) => {
  const cores = tokens.map(normalizeToken);
  if (!cores.includes("grid")) return false;
  return cores.some((core) => {
    if (!core.startsWith("grid-cols-")) return false;
    if (core === "grid-cols-1") return false;
    const match = core.match(/^grid-cols-(\d+)$/);
    if (match) return Number(match[1]) > 1;
    const bracket = core.match(/^grid-cols-\[(\d+)\]$/);
    if (bracket) return Number(bracket[1]) > 1;
    return false;
  });
};

const stripCardMaxWFromGrid = (nodes, childrenMap, source) => {
  const patches = [];
  const changes = [];
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs);
    if (!isMultiColumnGrid(tokens)) return;

    const children = getElementChildren(nodes, childrenMap, nodeIndex);
    for (const childIndex of children) {
      const child = nodes[childIndex];
      if (!child?.attrs) continue;
      if (isDecorative(child)) continue;
      if (isMediaTag(child.tag)) continue;

      const childTokens = getClassTokens(child.attrs);
      if (!childTokens.length) continue;
      const cores = childTokens.map(normalizeToken);
      const hasWFull = cores.includes("w-full");
      const hasMaxW = childTokens.some((t) => MAX_W_TOKEN.test(normalizeToken(t)));
      const hasCentering = cores.includes("self-center") || cores.includes("mx-auto");
      if (!hasWFull || !hasMaxW || !hasCentering) continue;

      const cleaned = childTokens.filter((t) => {
        const core = normalizeToken(t);
        if (core === "self-center" || core === "mx-auto") return false;
        if (MAX_W_TOKEN.test(core)) return false;
        return true;
      });

      if (tokensEqual(cleaned, childTokens)) continue;

      setClassTokens(child.attrs, child.attrOrder, cleaned);
      patches.push(
        createPatch(
          child.openStart,
          child.openEnd,
          buildOpenTag(child.tag, child.attrs, child.attrOrder, child.isSelfClosing)
        )
      );

      const meta = getNodeMeta(child);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "gridCardUncap",
        value: "remove max-w + centering",
        reason: "Grid cards should fill multi-column tracks",
      });
      adjusted += 1;
    }
  });

  return {
    html: applyPatches(source, patches),
    changes,
    adjusted,
  };
};

const cleanRootTokens = (tokens) => {
  const cleaned = [];
  for (const token of tokens) {
    const core = normalizeToken(token);
    if (core === "mx-auto") continue;
    if (MAX_W_TOKEN.test(core)) continue;
    if (WIDTH_TOKEN.test(core) && core !== "w-full") continue;
    cleaned.push(token);
  }
  if (!cleaned.some((t) => normalizeToken(t) === "w-full")) {
    cleaned.push("w-full");
  }
  return cleaned;
};

const apply = ({ html }) => {
  let source = String(html || "");
  if (!source) {
    return {
      html: source,
      changes: [],
      warnings: [],
      stats: { wrapped: 0, adjusted: 0, gridAdjusted: 0 },
    };
  }

  let nodes = parseHtmlNodes(source);
  let childrenMap = buildChildrenMap(nodes);
  const gridResult = stripCardMaxWFromGrid(nodes, childrenMap, source);
  source = gridResult.html;

  nodes = parseHtmlNodes(source);
  childrenMap = buildChildrenMap(nodes);
  const hasContainerToken = hasMaxWContainerToken(nodes);
  const patches = [];
  const changes = [...gridResult.changes];
  let wrapped = 0;
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tag = (node.tag || "").toLowerCase();
    if (!SECTION_TAGS.has(tag)) return;

    const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
    const isTopMost = node.parentIndex == null;
    if (dataKey !== "root" && !isTopMost) return;

    const tokens = getClassTokens(node.attrs);
    if (!hasPaddingOrBg(tokens)) return;
    if (!hasLayoutChild(nodes, childrenMap, nodeIndex)) return;
    if (isDecorative(node)) return;
    if (isMediaOnlyRoot(nodes, childrenMap, nodeIndex)) return;
    if (node.closeStart == null) return;

    const containerChildIndex = hasInnerContainerChild(nodes, childrenMap, nodeIndex);
    const cleanedRootTokens = cleanRootTokens(tokens);

    if (!tokensEqual(cleanedRootTokens, tokens)) {
      setClassTokens(node.attrs, node.attrOrder, cleanedRootTokens);
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
        op: "rootWidthNormalize",
        value: "w-full",
        reason: "Section roots should be full-width containers",
      });
      adjusted += 1;
    }

    if (containerChildIndex != null) {
      const container = nodes[containerChildIndex];
      if (!container?.attrs) return;
      const containerTokens = getClassTokens(container.attrs);
      if (!containerTokens.some((t) => normalizeToken(t) === "w-full")) {
        const nextTokens = dedupeByCore(["w-full", ...containerTokens]);
        setClassTokens(container.attrs, container.attrOrder, nextTokens);
        patches.push(
          createPatch(
            container.openStart,
            container.openEnd,
            buildOpenTag(
              container.tag,
              container.attrs,
              container.attrOrder,
              container.isSelfClosing
            )
          )
        );
        const meta = getNodeMeta(container);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "containerNormalize",
          value: "add w-full",
          reason: "Container pattern requires full-width inner wrapper",
        });
        adjusted += 1;
      }
      return;
    }

    const children = getElementChildren(nodes, childrenMap, nodeIndex);
    const childMaxW = [];
    children.forEach((idx) => {
      const child = nodes[idx];
      if (!child?.attrs) return;
      const childTokens = getClassTokens(child.attrs);
      childMaxW.push(...getMaxWidthTokens(childTokens));
    });

    let chosenMaxW = null;
    if (childMaxW.length) {
      chosenMaxW = pickLargestMaxW(childMaxW);
    }

    if (!chosenMaxW) {
      const rootMaxW = getMaxWidthTokens(tokens);
      const rootFixedAsMaxW = tokens
        .filter((t) => {
          const core = normalizeToken(t);
          return core.startsWith("w-[") && core.endsWith("]");
        })
        .map((t) => t.replace("w-[", "max-w-["));
      const rootCandidates = [...rootMaxW, ...rootFixedAsMaxW];
      chosenMaxW = pickLargestMaxW(rootCandidates);
    }

    if (!chosenMaxW) {
      chosenMaxW = hasContainerToken ? "max-w-container" : "max-w-[80rem]";
    }

    const innerTokens = dedupeByCore(["w-full", "mx-auto", chosenMaxW]);
    const innerAttrs = { class: innerTokens.join(" ") };
    const innerOrder = ["class"];
    const innerOpen = buildOpenTag("div", innerAttrs, innerOrder, false);
    const innerContent = source.slice(node.openEnd, node.closeStart);
    const replacement = innerOpen + innerContent + "</div>";

    patches.push(createPatch(node.openEnd, node.closeStart, replacement));
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "wrapInnerContainer",
      value: innerTokens.join(" "),
      reason: "Section root lacked inner container",
    });
    wrapped += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings: [],
    stats: { wrapped, adjusted, gridAdjusted: gridResult.adjusted },
  };
};

module.exports = {
  id,
  apply,
};
