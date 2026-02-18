const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag, isInteractiveTag } = require("../../utilities/select");

const id = "layout/width/responsiveWidthContainerGuard";

const SECTION_TAGS = new Set(["section", "header", "main", "article"]);
const CONTAINER_TAGS = new Set(["div", "section", "header", "main", "article", "aside", "nav"]);

const normalizeToken = (token) => String(token || "").split(":").pop();

const splitTokenPrefix = (token) => {
  const raw = String(token || "").trim();
  const idx = raw.lastIndexOf(":");
  if (idx < 0) return { prefix: "", core: raw };
  return { prefix: raw.slice(0, idx), core: raw.slice(idx + 1) };
};

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node?.parentIndex;
    if (parent == null) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const getElementChildren = (nodes, childrenMap, nodeIndex) =>
  (childrenMap.get(nodeIndex) || []).filter((idx) => nodes[idx]?.tag);

const isDecorative = (node) => String(getAttrValue(node?.attrs || {}, "data-decorative") || "") === "1";

const hasMdFlexRow = (tokens) =>
  tokens.some((token) => {
    const raw = String(token || "");
    return raw === "md:flex-row" || raw.endsWith(":md:flex-row");
  });

const hasColumnFlexAtMd = (tokens) =>
  tokens.some((token) => {
    const raw = String(token || "");
    const core = normalizeToken(raw);
    if (core === "flex-1") return true;
    if (raw === "md:flex-1" || raw.endsWith(":md:flex-1")) return true;
    if (core === "grow" && (raw === "md:grow" || raw.endsWith(":md:grow"))) return true;
    if (core === "basis-0" && (raw === "md:basis-0" || raw.endsWith(":md:basis-0"))) return true;
    return false;
  });

const hasMinW0 = (tokens) =>
  tokens.some((token) => {
    const core = normalizeToken(token);
    return core === "min-w-0";
  });

const parseArbitraryWidthCore = (core) => {
  const m = String(core || "").match(/^w-\[([0-9]+(?:\.[0-9]+)?)(px|rem)\]$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2];
  const px = unit === "rem" ? value * 16 : value;
  return { px };
};

const isLikelyFixedSizeToken = (core) => {
  const parsed = parseArbitraryWidthCore(core);
  if (!parsed) return false;
  return parsed.px <= 160;
};

const isMediaLikeNode = (node) => {
  const tag = String(node?.tag || "").toLowerCase();
  if (isMediaTag(tag)) return true;
  const attrs = node?.attrs || {};
  if (String(getAttrValue(attrs, "data-bg-type") || "").trim()) return true;
  if (String(getAttrValue(attrs, "data-fill-type") || "").trim()) return true;
  if (String(getAttrValue(attrs, "data-media") || "").trim()) return true;
  const tokens = getClassTokens(attrs).map(normalizeToken);
  return tokens.some((core) => core === "object-cover" || core.startsWith("aspect-"));
};

const isContainerCapCandidate = (node, tokens) => {
  if (!node?.attrs) return false;
  if (isDecorative(node)) return false;
  if (isMediaLikeNode(node)) return false;
  const tag = String(node.tag || "").toLowerCase();
  if (CONTAINER_TAGS.has(tag)) return true;
  const cores = tokens.map(normalizeToken);
  return (
    cores.includes("w-full") ||
    cores.includes("mx-auto") ||
    cores.includes("self-center") ||
    cores.includes("self-start") ||
    cores.includes("self-end")
  );
};

const isMaxWCapCore = (core) => /^max-w-/.test(core) && core !== "max-w-full" && core !== "max-w-none";

const isMaxWCapActiveAtMd = (token) => {
  const { prefix, core } = splitTokenPrefix(token);
  if (!isMaxWCapCore(core)) return false;
  if (!prefix) return true;
  const variants = prefix.split(":").filter(Boolean);
  if (!variants.length) return true;
  if (variants.some((v) => v.startsWith("max-"))) return false;
  if (variants.includes("sm") || variants.includes("md")) return true;
  return false;
};

const hasTokenCore = (tokens, core) => tokens.some((token) => normalizeToken(token) === core);

const canonicalizeSectionContainer = (node) => {
  const tag = String(node?.tag || "").toLowerCase();
  if (!SECTION_TAGS.has(tag)) return null;
  const attrs = node?.attrs || {};
  const tokens = getClassTokens(attrs);
  if (!tokens.length) return null;

  const hasMaxW = tokens.some((token) => isMaxWCapCore(normalizeToken(token)));
  if (!hasMaxW) return null;

  const next = [];
  let removedFixed = false;
  tokens.forEach((token) => {
    const { core } = splitTokenPrefix(token);
    if (/^w-\[[^\]]+\]$/.test(core) && hasTokenCore(tokens, "w-full")) {
      removedFixed = true;
      return;
    }
    next.push(token);
  });

  let changed = removedFixed;
  if (!hasTokenCore(next, "w-full")) {
    next.push("w-full");
    changed = true;
  }
  if (!hasTokenCore(next, "mx-auto")) {
    next.push("mx-auto");
    changed = true;
  }

  if (!changed) return null;
  return { before: tokens, after: next };
};

const enforceColumnSizing = (node) => {
  if (!node?.attrs) return null;
  if (isMediaLikeNode(node)) return null;
  if (isDecorative(node)) return null;
  if (isInteractiveTag(node.tag)) return null;

  const tokens = getClassTokens(node.attrs);
  if (!tokens.length) return null;
  const next = [...tokens];
  let changed = false;

  if (!hasColumnFlexAtMd(next)) {
    next.push("md:flex-1");
    changed = true;
  }
  if (!hasMinW0(next)) {
    next.push("min-w-0");
    changed = true;
  }

  // Non-media layout columns should not keep large fixed arbitrary widths.
  const fixedW = next.filter((token) => /^w-\[[^\]]+\]$/.test(normalizeToken(token)));
  fixedW.forEach((token) => {
    const core = normalizeToken(token);
    if (isLikelyFixedSizeToken(core)) return;
    const idx = next.indexOf(token);
    if (idx >= 0) {
      next.splice(idx, 1);
      changed = true;
    }
    const maxW = core.replace(/^w-/, "max-w-");
    if (!hasTokenCore(next, maxW)) {
      next.push(maxW);
      changed = true;
    }
  });

  if (!fixedW.length) return changed ? { before: tokens, after: next } : null;
  if (!hasTokenCore(next, "w-full")) {
    next.push("w-full");
    changed = true;
  }
  if (!hasTokenCore(next, "max-w-full")) {
    next.push("max-w-full");
    changed = true;
  }

  return changed ? { before: tokens, after: next } : null;
};

const neutralizeMdCapsInSubtree = (nodes, childrenMap, rootIndex, queueNodeUpdate, telemetry) => {
  const queue = [rootIndex];
  let touched = 0;
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) continue;
    queue.push(...getElementChildren(nodes, childrenMap, idx));

    const tokens = getClassTokens(node.attrs);
    telemetry.capScanNodes += 1;
    if (!tokens.length) continue;
    if (!isContainerCapCandidate(node, tokens)) {
      if (isDecorative(node)) telemetry.skippedDecorative += 1;
      else if (isMediaLikeNode(node)) telemetry.skippedMedia += 1;
      else if (isInteractiveTag(node.tag)) telemetry.skippedInteractive += 1;
      else telemetry.capCandidateMisses += 1;
      continue;
    }
    telemetry.capCandidateNodes += 1;
    const activeCaps = tokens.filter((token) => isMaxWCapActiveAtMd(token));
    if (!activeCaps.length) {
      telemetry.capCandidateMisses += 1;
      continue;
    }
    telemetry.capsDetected += activeCaps.length;

    const next = tokens.filter((token) => {
      const { prefix, core } = splitTokenPrefix(token);
      if (!isMaxWCapCore(core)) return true;
      if (prefix === "md") return false;
      return true;
    });
    let changed = next.length !== tokens.length;

    if (!hasTokenCore(next, "max-w-full")) {
      next.push("max-w-full");
      changed = true;
    }
    if (!next.includes("md:max-w-none")) {
      next.push("md:max-w-none");
      changed = true;
    }
    if (!changed) continue;
    telemetry.capsNeutralized += activeCaps.length;
    queueNodeUpdate(node, next, "guarded max-width cap inside md column subtree");
    touched += 1;
  }
  return touched;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) {
    return {
      html: source,
      changes: [],
      warnings: [],
      stats: {
        normalizedContainers: 0,
        guardedColumns: 0,
        uncappedNodes: 0,
        rowsScanned: 0,
        rowsEligible: 0,
        capScanNodes: 0,
        capCandidateNodes: 0,
        capCandidateMisses: 0,
        capsDetected: 0,
        capsNeutralized: 0,
        skippedMedia: 0,
        skippedDecorative: 0,
        skippedInteractive: 0,
      },
    };
  }

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patchByNodeStart = new Map();
  const changes = [];
  const warnings = [];
  let normalizedContainers = 0;
  let guardedColumns = 0;
  let uncappedNodes = 0;
  let rowsScanned = 0;
  let rowsEligible = 0;
  const telemetry = {
    capScanNodes: 0,
    capCandidateNodes: 0,
    capCandidateMisses: 0,
    capsDetected: 0,
    capsNeutralized: 0,
    skippedMedia: 0,
    skippedDecorative: 0,
    skippedInteractive: 0,
  };

  const queueNodeUpdate = (node, nextTokens, reason) => {
    setClassTokens(node.attrs, node.attrOrder, nextTokens);
    patchByNodeStart.set(
      node.openStart,
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
      op: "classGuard",
      value: reason,
      reason,
    });
  };

  nodes.forEach((node, index) => {
    if (!node?.attrs) return;

    const sectionFix = canonicalizeSectionContainer(node);
    if (sectionFix) {
      queueNodeUpdate(node, sectionFix.after, "section container canonicalized to w-full + max-w + mx-auto");
      normalizedContainers += 1;
    }

    const parentTokens = getClassTokens(node.attrs);
    if (!hasMdFlexRow(parentTokens)) return;
    rowsScanned += 1;
    const childIndices = getElementChildren(nodes, childrenMap, index).filter((childIdx) => {
      const child = nodes[childIdx];
      if (!child?.attrs) return false;
      if (isDecorative(child)) return false;
      return true;
    });
    if (childIndices.length !== 2) return;
    rowsEligible += 1;

    childIndices.forEach((childIdx) => {
      const child = nodes[childIdx];
      const colFix = enforceColumnSizing(child);
      if (colFix) {
        queueNodeUpdate(child, colFix.after, "md two-column row enforced with flex fill + min-w-0");
        guardedColumns += 1;
      }
      uncappedNodes += neutralizeMdCapsInSubtree(
        nodes,
        childrenMap,
        childIdx,
        queueNodeUpdate,
        telemetry
      );
    });
  });

  return {
    html: applyPatches(source, Array.from(patchByNodeStart.values())),
    changes,
    warnings,
    stats: {
      normalizedContainers,
      guardedColumns,
      uncappedNodes,
      rowsScanned,
      rowsEligible,
      ...telemetry,
    },
  };
};

module.exports = {
  id,
  apply,
};
