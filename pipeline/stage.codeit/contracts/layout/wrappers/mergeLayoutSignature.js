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

const id = "layout/wrappers/mergeLayoutSignature";

const normalizeToken = (token) => String(token || "").split(":").pop();

const SIGNATURE_RE = [
  /^flex$/,
  /^inline-flex$/,
  /^flex-col$/,
  /^flex-row$/,
  /^grid$/,
  /^inline-grid$/,
  /^grid-cols-/,
  /^gap-/,
  /^items-/,
  /^justify-/,
  /^w-full$/,
  /^max-w-full$/,
  /^self-start$/,
];

const DISALLOW_RE = [
  /^p-|^px-|^py-|^pt-|^pr-|^pb-|^pl-/,
  /^m-|^mx-|^my-|^mt-|^mr-|^mb-|^ml-/,
  /^bg-/,
  /^border/,
  /^rounded/,
  /^shadow/,
  /^absolute$|^relative$|^fixed$|^sticky$/,
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
  }
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (dataKey && !dataKey.startsWith("instance:") && !dataKey.startsWith("frame:")) return true;
  if (getAttrValue(node.attrs, "data-node-id") && !dataKey) return true;
  return false;
};

const signatureOf = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.filter((c) => SIGNATURE_RE.some((re) => re.test(c)));
};

const hasDisallowedTokens = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => DISALLOW_RE.some((re) => re.test(c)));
};

const equalSignature = (a, b) => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { merged: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let merged = 0;
  const removed = new Set();

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if (removed.has(nodeIndex)) continue;
    const node = nodes[nodeIndex];
    if (!node || (node.tag || "").toLowerCase() !== "div") continue;
    if (node.isSelfClosing) continue;
    if (hasDisallowedAttr(node)) continue;
    const children = childrenMap.get(nodeIndex) || [];
    if (children.length !== 1) continue;
    const childIndex = children[0];
    const child = nodes[childIndex];
    if (!child || (child.tag || "").toLowerCase() !== "div") continue;
    if (child.isSelfClosing) continue;
    if (hasDisallowedAttr(child)) continue;

    const parentTokens = getClassTokens(node.attrs || {});
    const childTokens = getClassTokens(child.attrs || {});
    if (hasDisallowedTokens(parentTokens) || hasDisallowedTokens(childTokens)) continue;

    const parentSig = signatureOf(parentTokens);
    const childSig = signatureOf(childTokens);
    if (!equalSignature(parentSig, childSig)) continue;

    const parentNonSig = parentTokens.filter((t) => !parentSig.includes(normalizeToken(t)));
    const childNonSig = childTokens.filter((t) => !childSig.includes(normalizeToken(t)));
    if (parentNonSig.length || childNonSig.length) continue;

    const innerHtml = source.slice(child.openEnd, child.closeStart);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    patches.push(createPatch(child.openStart, child.closeEnd, innerHtml));

    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "mergeWrapper",
      value: "merged redundant layout wrapper",
      reason: "Parent and child shared identical layout signature",
    });
    removed.add(childIndex);
    merged += 1;
  }

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { merged },
  };
};

module.exports = {
  id,
  apply,
};
