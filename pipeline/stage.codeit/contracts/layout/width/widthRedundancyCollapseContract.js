const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "layout/width/widthRedundancyCollapseContract";

const BREAKPOINTS = new Set(["sm", "md", "lg", "xl", "2xl"]);

const normalizeToken = (token) => String(token || "").split(":").pop();

const getPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length === 1) return "";
  if (parts.length === 2 && BREAKPOINTS.has(parts[0])) return parts[0];
  return null;
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

const isRootContainer = (node) => {
  const dataKey = String(node.attrs?.["data-key"] || "");
  if (dataKey === "root") return true;
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  return cores.includes("max-w-[80rem]") && cores.includes("mx-auto");
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

const hasMediaDataHint = (node) => {
  const keys = Object.keys(node.attrs || {});
  return keys.some((k) => k.startsWith("data-media") || k.startsWith("data-bg-") || k.startsWith("data-img-"));
};

const parseWidthToken = (token) => {
  const prefix = getPrefix(token);
  if (prefix === null) return null;
  const core = normalizeToken(token);
  if (core === "max-w-full") return { kind: "max", unit: "full", value: Infinity, prefix, token };
  const maxMatch = core.match(/^max-w-\[(\d+(?:\.\d+)?)(rem|px)\]$/);
  if (maxMatch) {
    return { kind: "max", unit: maxMatch[2], value: parseFloat(maxMatch[1]), prefix, token };
  }
  const wMatch = core.match(/^w-\[(\d+(?:\.\d+)?)(rem|px)\]$/);
  if (wMatch) {
    return { kind: "w", unit: wMatch[2], value: parseFloat(wMatch[1]), prefix, token };
  }
  return null;
};

const isWidthToken = (token) => {
  const core = normalizeToken(token);
  return core.startsWith("w-") || core.startsWith("max-w-");
};

const buildAncestorCeilings = (nodes, nodeIndex) => {
  const ceilings = new Map();
  let current = nodes[nodeIndex]?.parentIndex;
  while (current != null) {
    const node = nodes[current];
    const tokens = getClassTokens(node.attrs || {});
    tokens.forEach((t) => {
      const parsed = parseWidthToken(t);
      if (!parsed) return;
      if (parsed.unit === "full") return;
      const key = `${parsed.prefix}|${parsed.unit}`;
      const existing = ceilings.get(key);
      const candidate = { value: parsed.value, kind: parsed.kind };
      if (!existing || candidate.value < existing.value) {
        ceilings.set(key, candidate);
      }
    });
    current = node.parentIndex;
  }
  return ceilings;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let removed = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    const tag = (node.tag || "").toLowerCase();
    if (isMediaTag(tag)) return;
    if (isRootContainer(node)) return;
    if (hasMediaDataHint(node)) return;
    if (isMediaWrapper(node, nodes, childrenMap, nodeIndex)) return;

    const tokens = getClassTokens(node.attrs || {});
    const ceilings = buildAncestorCeilings(nodes, nodeIndex);
    if (!tokens.length || ceilings.size === 0) return;

    const next = [];
    let changed = false;

    tokens.forEach((t) => {
      const parsed = parseWidthToken(t);
      if (!parsed) {
        next.push(t);
        return;
      }
      if (parsed.kind === "w") {
        const key = `${parsed.prefix}|${parsed.unit}`;
        const ceiling = ceilings.get(key);
        if (ceiling && ceiling.kind === "w" && ceiling.value === parsed.value) {
          changed = true;
          return;
        }
        next.push(t);
        return;
      }
      if (parsed.kind === "max") {
        if (parsed.unit === "full") {
          const hasAnyCeiling = Array.from(ceilings.keys()).some((k) => k.startsWith(`${parsed.prefix}|`));
          if (hasAnyCeiling) {
            changed = true;
            return;
          }
          next.push(t);
          return;
        }
        const key = `${parsed.prefix}|${parsed.unit}`;
        const ceiling = ceilings.get(key);
        if (ceiling && ceiling.value <= parsed.value) {
          changed = true;
          return;
        }
        next.push(t);
        return;
      }
      next.push(t);
    });

    if (!changed) return;
    setClassTokens(node.attrs, node.attrOrder, next);
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
      op: "widthRedundancyCollapse",
      value: "removed redundant width constraints",
      reason: "Ancestor already enforces equivalent or stricter width",
    });
    removed += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { removed },
  };
};

module.exports = {
  id,
  apply,
};
