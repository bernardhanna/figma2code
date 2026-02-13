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

const id = "layout/wrappers/flattenRedundant";

const LANDMARK_TAGS = new Set([
  "main",
  "nav",
  "header",
  "footer",
  "aside",
  "section",
  "article",
  "form",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Tokens that are safe no-ops on a wrapper (can merge to child). */
const ALLOWLIST_CORE = new Set(["max-w-full", "w-full", "self-start", "shrink-0"]);

const normalizeToken = (token) => String(token || "").split(":").pop();

/** Disallow if wrapper has any of these (core token patterns). */
const DISALLOW_PREFIXES = [
  /^p-|^px-|^py-|^pt-|^pr-|^pb-|^pl-/, // padding
  /^m-|^mx-|^my-|^mt-|^mr-|^mb-|^ml-/, // margin
  /^gap-/,
  /^bg-/,
  /^border/,
  /^rounded/,
  /^shadow/,
  /^absolute$|^relative$|^fixed$|^sticky$/,
  /^flex|^inline-flex|^flex-col|^flex-row|^items-|^justify-|^grow|^shrink|^basis-/,
  /^grid|^grid-cols|^grid-rows/,
  /^overflow-/,
  /^z-|^z-\d/,
];

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

const hasDisallowedAttr = (node) => {
  if (!node.attrs) return false;
  for (const key of Object.keys(node.attrs)) {
    const k = key.toLowerCase();
    if (k === "id" || k === "role") return true;
    if (k.startsWith("aria-")) return true;
    if (k === "data-key" || k === "data-node-id") return true;
  }
  return false;
};

/** Do not flatten decorative components. */
const isDecorativeOrBar = (node) => {
  if (!node.attrs) return false;
  const decorative = getAttrValue(node.attrs, "data-decorative");
  if (decorative != null && String(decorative).trim() === "1") return true;
  const dataKey = getAttrValue(node.attrs, "data-key");
  if (dataKey != null && String(dataKey).toLowerCase().includes("decorativebar")) return true;
  return false;
};

/** True if any descendant (or self) has data-decorative="1" or decorativebar in data-key. */
const hasDecorativeInSubtree = (nodes, childrenMap, nodeIndex) => {
  const queue = [nodeIndex];
  while (queue.length) {
    const idx = queue.shift();
    const n = nodes[idx];
    if (n && isDecorativeOrBar(n)) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

const hasOnlyAllowlistClasses = (tokens) => {
  if (!tokens.length) return true;
  const normalized = tokens.map(normalizeToken);
  return normalized.every((core) => ALLOWLIST_CORE.has(core));
};

const hasDisallowedClass = (tokens) => {
  const normalized = tokens.map(normalizeToken);
  return normalized.some((core) =>
    DISALLOW_PREFIXES.some((re) => re.test(core))
  );
};

/** Get allowlist tokens from wrapper to merge down (only those in ALLOWLIST_CORE). */
const getAllowlistTokens = (tokens) =>
  tokens.filter((t) => ALLOWLIST_CORE.has(normalizeToken(t)));

/** Merge safe classes into child: add any from wrapperAllowlist that child doesn't have (by core). */
const mergeClassesIntoChild = (childTokens, wrapperAllowlist) => {
  const childCores = new Set(childTokens.map(normalizeToken));
  const out = [...childTokens];
  for (const t of wrapperAllowlist) {
    const core = normalizeToken(t);
    if (!childCores.has(core)) {
      out.push(t);
      childCores.add(core);
    }
  }
  return out;
};

/** True if node is a redundant wrapper that can be removed. */
const isRedundantWrapper = (nodes, childrenMap, nodeIndex, source) => {
  const node = nodes[nodeIndex];
  if (!node || (node.tag || "").toLowerCase() !== "div") return false;
  if (node.isSelfClosing) return false;
  if (node.closeStart == null || node.closeEnd == null) return false;
  if (hasDisallowedAttr(node)) return false;

  const children = childrenMap.get(nodeIndex);
  if (!children || children.length !== 1) return false;
  const childIndex = children[0];
  const child = nodes[childIndex];
  if (!child || child.isSelfClosing) return false;

  const tokens = getClassTokens(node.attrs);
  if (hasDisallowedClass(tokens)) return false;
  if (!hasOnlyAllowlistClasses(tokens)) return false;

  const parentIndex = node.parentIndex;
  if (parentIndex != null) {
    const parent = nodes[parentIndex];
    if (parent && HEADING_TAGS.has((parent.tag || "").toLowerCase()))
      return false;
  }
  if (LANDMARK_TAGS.has((child.tag || "").toLowerCase())) return false;
  if (isDecorativeOrBar(node)) return false;
  if (hasDecorativeInSubtree(nodes, childrenMap, nodeIndex)) return false;

  return true;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { flattened: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let flattened = 0;
  const removed = new Set();

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    if (removed.has(nodeIndex)) continue;
    if (!isRedundantWrapper(nodes, childrenMap, nodeIndex, source)) continue;

    const wrapper = nodes[nodeIndex];
    const childIndex = childrenMap.get(nodeIndex)[0];
    const child = nodes[childIndex];

    const childIsAlsoWrapper =
      isRedundantWrapper(nodes, childrenMap, childIndex, source);
    const grandchildIndex = childIsAlsoWrapper
      ? childrenMap.get(childIndex)[0]
      : null;
    const grandchild = grandchildIndex != null ? nodes[grandchildIndex] : null;

    let targetNode;
    let classesToMerge;
    let innerStart;
    let innerEnd;
    let replaceStart;
    let replaceEnd;

    if (childIsAlsoWrapper && grandchild && !removed.has(childIndex)) {
      targetNode = grandchild;
      const wrapTokens = getClassTokens(wrapper.attrs);
      const childTokens = getClassTokens(child.attrs);
      const allow1 = getAllowlistTokens(wrapTokens);
      const allow2 = getAllowlistTokens(childTokens);
      const merged = mergeClassesIntoChild(
        getClassTokens(grandchild.attrs),
        [...allow1, ...allow2]
      );
      classesToMerge = merged;
      innerStart = grandchild.openEnd;
      innerEnd = grandchild.closeStart;
      replaceStart = wrapper.openStart;
      replaceEnd = wrapper.closeEnd;
      removed.add(childIndex);
      removed.add(nodeIndex);
    } else {
      targetNode = child;
      const wrapTokens = getClassTokens(wrapper.attrs);
      const allow = getAllowlistTokens(wrapTokens);
      classesToMerge = mergeClassesIntoChild(
        getClassTokens(child.attrs),
        allow
      );
      innerStart = child.openEnd;
      innerEnd = child.closeStart;
      replaceStart = wrapper.openStart;
      replaceEnd = wrapper.closeEnd;
      removed.add(nodeIndex);
    }

    const newAttrs = { ...targetNode.attrs };
    const newOrder = [...(targetNode.attrOrder || [])];
    setClassTokens(newAttrs, newOrder, classesToMerge);
    const newOpenTag = buildOpenTag(
      targetNode.tag,
      newAttrs,
      newOrder,
      targetNode.isSelfClosing
    );
    const innerHtml =
      innerEnd > innerStart ? source.slice(innerStart, innerEnd) : "";
    const replacement =
      newOpenTag + innerHtml + `</${targetNode.tag}>`;

    patches.push(
      createPatch(replaceStart, replaceEnd, replacement)
    );
    const meta = getNodeMeta(targetNode);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "flattenWrapper",
      value: "Removed redundant wrapper",
      reason: "Flattened redundant wrapper into child",
    });
    flattened += 1;
  }

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { flattened },
  };
};

module.exports = {
  id,
  apply,
};
