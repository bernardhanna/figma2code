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
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/cleanup/previewNormalize";

const normalizeToken = (token) => String(token || "").split(":").pop();
const getPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(":");
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

const addStateTokensFromData = (node, tokens) => {
  if (!node?.attrs) return tokens;
  const out = [...tokens];
  const pushIfMissing = (token) => {
    if (!token) return;
    if (!out.includes(token)) out.push(token);
  };

  const stateClasses = getAttrValue(node.attrs, "data-state-classes");
  if (stateClasses) {
    String(stateClasses || "")
      .split(/\s+/g)
      .filter(Boolean)
      .forEach((t) => pushIfMissing(t));
  }

  const addVariant = (variant, prefix, value) => {
    if (!value) return;
    const v = String(value || "").trim();
    if (!v) return;
    if (v.includes(":")) {
      pushIfMissing(v);
      return;
    }
    if (v.startsWith(`${prefix}-`)) {
      pushIfMissing(`${variant}:${v}`);
      return;
    }
    if (v.startsWith("#") || v.startsWith("rgb")) {
      pushIfMissing(`${variant}:${prefix}-[${v}]`);
      return;
    }
    if (prefix === "opacity") {
      pushIfMissing(`${variant}:opacity-[${v}]`);
      return;
    }
    pushIfMissing(`${variant}:${prefix}-[${v}]`);
  };

  addVariant("hover", "bg", getAttrValue(node.attrs, "data-hover-bg"));
  addVariant("hover", "opacity", getAttrValue(node.attrs, "data-hover-opacity"));
  addVariant("hover", "text", getAttrValue(node.attrs, "data-hover-text"));
  addVariant("hover", "border", getAttrValue(node.attrs, "data-hover-border"));

  addVariant("active", "bg", getAttrValue(node.attrs, "data-active-bg"));
  addVariant("active", "opacity", getAttrValue(node.attrs, "data-active-opacity"));

  addVariant("focus", "ring", getAttrValue(node.attrs, "data-focus-ring"));
  addVariant("focus-visible", "ring", getAttrValue(node.attrs, "data-focus-visible-ring"));

  return out;
};

const getElementChildren = (nodes, childrenMap, nodeIndex) =>
  (childrenMap.get(nodeIndex) || []).filter((i) => nodes[i]?.tag);

const isProtectedToken = (token) => {
  const t = String(token || "");
  const core = normalizeToken(t);
  if (
    t.includes("hover:") ||
    t.includes("focus:") ||
    t.includes("focus-visible:") ||
    t.includes("focus-within:") ||
    t.includes("active:") ||
    t.includes("group-focus:") ||
    t.includes("group-active:") ||
    t.includes("group-hover:") ||
    t.includes("peer-") ||
    t.includes("peer:") ||
    t.includes("aria-") ||
    t.includes("data-[")
  ) {
    return true;
  }
  if (
    /^transition(-|$)/.test(core) ||
    /^duration-/.test(core) ||
    /^ease-/.test(core) ||
    /^ring(-|$)/.test(core) ||
    /^outline(-|$)/.test(core)
  ) {
    return true;
  }
  return false;
};

const ALLOWED_MOVE = [
  /^flex$/,
  /^inline-flex$/,
  /^grid$/,
  /^inline-grid$/,
  /^flex-col$/,
  /^flex-row$/,
  /^flex-wrap$/,
  /^items-/,
  /^justify-/,
  /^gap-/,
  /^self-/,
  /^grow$/,
  /^shrink$/,
  /^basis-/,
  /^w-/,
  /^max-w-/,
  /^min-w-/,
  /^h-/,
  /^max-h-/,
  /^min-h-/,
  /^p-/,
  /^px-/,
  /^py-/,
  /^pt-/,
  /^pr-/,
  /^pb-/,
  /^pl-/,
  /^m-/,
  /^mx-/,
  /^my-/,
  /^mt-/,
  /^mr-/,
  /^mb-/,
  /^ml-/,
  /^overflow-/,
  /^relative$/,
  /^absolute$/,
  /^fixed$/,
  /^sticky$/,
  /^inset-/,
  /^top-/,
  /^right-/,
  /^bottom-/,
  /^left-/,
  /^z-/,
  /^transform$/,
  /^translate-/,
  /^origin-/,
  /^order-/,
  /^place-/,
];

const hasOnlyAllowedMovableClasses = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.every((c) => ALLOWED_MOVE.some((re) => re.test(c)));
};

const hasForbiddenClass = (tokens) => tokens.some((t) => isProtectedToken(t));

const hasContainerSignature = (tokens) => {
  const cores = tokens.map(normalizeToken);
  const hasMxAuto = cores.includes("mx-auto");
  const hasMaxW = cores.some((c) => c === "max-w-container" || /^max-w-/.test(c));
  return hasMxAuto && hasMaxW;
};

const hasDisallowedAttr = (node) => {
  if (!node?.attrs) return true;
  const keys = Object.keys(node.attrs);
  for (const key of keys) {
    const k = key.toLowerCase();
    if (k === "id" || k === "role" || k === "tabindex") return true;
    if (k === "href" || k === "type" || k === "name") return true;
    if (k.startsWith("aria-")) return true;
    if (k.startsWith("on")) return true;
    if (k === "style" || k === "class") continue;
    if (k.startsWith("data-")) continue;
    return true;
  }
  return false;
};

const mergeClassTokens = (parentTokens, childTokens) => {
  const out = [];
  const seen = new Set();
  const tokens = [...parentTokens, ...childTokens];
  for (const t of tokens) {
    if (isProtectedToken(t)) {
      out.push(t);
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
};

const normalizeClasses = (tokens) => {
  const maxWSpecificByPrefix = new Set();
  tokens.forEach((t) => {
    if (isProtectedToken(t)) return;
    const core = normalizeToken(t);
    if (core.startsWith("max-w-") && core !== "max-w-full") {
      maxWSpecificByPrefix.add(getPrefix(t));
    }
  });
  const baseCores = new Set(
    tokens.filter((t) => !String(t).includes(":") && !isProtectedToken(t)).map(normalizeToken)
  );
  const out = [];
  const seen = new Set();
  for (const t of tokens) {
    if (isProtectedToken(t)) {
      out.push(t);
      continue;
    }
    if (seen.has(t)) continue;
    const hasPrefix = String(t).includes(":");
    const core = normalizeToken(t);
    const prefix = getPrefix(t);
    if (core === "max-w-full" && maxWSpecificByPrefix.has(prefix)) continue;
    if (hasPrefix && baseCores.has(core)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
};

const mergeDataAttributes = (parent, child) => {
  const parentKeys = Object.keys(parent.attrs || {}).filter((k) => k.startsWith("data-"));
  if (!parentKeys.length) return;
  const blockMerge = new Set([
    "data-key",
    "data-node",
    "data-node-id",
    "data-w-intent",
    "data-h-intent",
    "data-w-rem",
    "data-h-rem",
    "data-merged-from",
  ]);
  const mergedEntries = [];
  for (const key of parentKeys) {
    if (blockMerge.has(String(key || "").toLowerCase())) continue;
    const value = getAttrValue(parent.attrs, key);
    if (!(key in (child.attrs || {}))) {
      setAttrValue(child.attrs, child.attrOrder, key, value);
    } else {
      const entry = `${key}=${value == null ? "" : String(value)}`;
      mergedEntries.push(entry);
    }
  }
  if (mergedEntries.length) {
    const existing = getAttrValue(child.attrs, "data-merged-from");
    const next = existing ? `${existing};${mergedEntries.join(";")}` : mergedEntries.join(";");
    setAttrValue(child.attrs, child.attrOrder, "data-merged-from", next);
  }
};

const shouldCollapseWrapper = (nodes, childrenMap, nodeIndex) => {
  const node = nodes[nodeIndex];
  if (!node || node.tag !== "div") return false;
  if (node.isSelfClosing || node.closeStart == null) return false;
  if (hasDisallowedAttr(node)) return false;
  const children = getElementChildren(nodes, childrenMap, nodeIndex);
  if (!children || children.length !== 1) return false;
  const child = nodes[children[0]];
  if (!child || child.tag !== "div") return false;
  if (child.isSelfClosing || child.closeStart == null) return false;
  if (hasDisallowedAttr(child)) return false;

  const parentTokens = getClassTokens(node.attrs || {});
  const childTokens = getClassTokens(child.attrs || {});
  if (hasContainerSignature(parentTokens)) return false;
  if (hasForbiddenClass(parentTokens)) return false;
  if (!hasOnlyAllowedMovableClasses(parentTokens)) return false;

  const parentStyle = getAttrValue(node.attrs, "style");
  const childStyle = getAttrValue(child.attrs, "style");
  if (parentStyle && childStyle) return false;

  return true;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { merged: 0, normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  const removed = new Set();
  const updated = new Set();
  let merged = 0;
  let normalized = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!shouldCollapseWrapper(nodes, childrenMap, nodeIndex)) return;
    const wrapper = nodes[nodeIndex];
    const childIndex = getElementChildren(nodes, childrenMap, nodeIndex)[0];
    const child = nodes[childIndex];

    const parentTokens = addStateTokensFromData(wrapper, getClassTokens(wrapper.attrs || {}));
    const childTokens = addStateTokensFromData(child, getClassTokens(child.attrs || {}));
    let mergedTokens = mergeClassTokens(parentTokens, childTokens);
    mergedTokens = normalizeClasses(mergedTokens);

    if (getAttrValue(wrapper.attrs, "style") && !getAttrValue(child.attrs, "style")) {
      setAttrValue(child.attrs, child.attrOrder, "style", getAttrValue(wrapper.attrs, "style"));
    }
    mergeDataAttributes(wrapper, child);
    setClassTokens(child.attrs, child.attrOrder, mergedTokens);

    patches.push(
      createPatch(
        child.openStart,
        child.openEnd,
        buildOpenTag(child.tag, child.attrs, child.attrOrder, child.isSelfClosing)
      )
    );
    patches.push(createPatch(wrapper.openStart, wrapper.openEnd, ""));
    if (wrapper.closeStart != null && wrapper.closeEnd != null) {
      patches.push(createPatch(wrapper.closeStart, wrapper.closeEnd, ""));
    }

    const meta = getNodeMeta(wrapper);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "collapseWrapper",
      value: "merged wrapper into child",
      reason: "Redundant wrapper with no unique semantics",
    });
    removed.add(nodeIndex);
    updated.add(childIndex);
    merged += 1;
  });

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (removed.has(nodeIndex)) return;
    if (updated.has(nodeIndex)) return;
    const tokens = addStateTokensFromData(node, getClassTokens(node.attrs || {}));
    if (!tokens.length) return;
    const next = normalizeClasses(tokens);
    if (next.length === tokens.length && next.every((t, i) => t === tokens[i])) return;
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
      op: "dedupeClasses",
      value: "removed duplicates",
      reason: "Removed redundant class tokens",
    });
    normalized += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { merged, normalized },
  };
};

module.exports = {
  id,
  apply,
};
