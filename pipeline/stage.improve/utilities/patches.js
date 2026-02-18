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
} = require("../../stage.codeit/contracts/utils/html");

const SAFE_ATTRS = new Set([
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-hidden",
  "aria-expanded",
  "aria-pressed",
  "aria-current",
  "aria-controls",
  "aria-haspopup",
  "aria-live",
  "aria-atomic",
  "aria-busy",
  "aria-selected",
  "aria-checked",
  "role",
]);

const normalizeTokenList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((token) => String(token || "").trim())
    .filter(Boolean);

const normalizeAttrMap = (value) => {
  if (!value || typeof value !== "object") return {};
  const out = {};
  Object.keys(value).forEach((key) => {
    const k = String(key || "").trim();
    if (!k) return;
    out[k] = String(value[key] ?? "").trim();
  });
  return out;
};

const dedupeTokens = (tokens) => {
  const out = [];
  const seen = new Set();
  tokens.forEach((token) => {
    if (seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  return out;
};

const normalizePatchOps = (patch) => {
  if (!patch) return null;
  const ops = patch.ops && typeof patch.ops === "object" ? patch.ops : patch;
  return {
    classAdd: normalizeTokenList(ops.classAdd),
    classRemove: normalizeTokenList(ops.classRemove),
    classReplace: normalizeAttrMap(ops.classReplace),
    attrAdd: normalizeAttrMap(ops.attrAdd),
    attrRemove: normalizeTokenList(ops.attrRemove),
  };
};

const validatePatch = (patch) => {
  if (!patch || typeof patch !== "object") {
    return { valid: false, reason: "Patch must be an object." };
  }

  const nodeId = String(patch.nodeId || "").trim();
  if (!nodeId) {
    return { valid: false, reason: "Patch missing nodeId." };
  }

  const ops = normalizePatchOps(patch);
  if (!ops) return { valid: false, reason: "Patch ops missing." };

  const allowedReplace = ops.classReplace && typeof ops.classReplace === "object";
  if (!allowedReplace) {
    return { valid: false, reason: "Patch classReplace must be an object." };
  }

  const disallowedAttrAdd = Object.keys(ops.attrAdd).find(
    (key) => !SAFE_ATTRS.has(key.toLowerCase())
  );
  if (disallowedAttrAdd) {
    return { valid: false, reason: `Patch attrAdd not allowed: ${disallowedAttrAdd}.` };
  }

  const disallowedAttrRemove = ops.attrRemove.find(
    (key) => !SAFE_ATTRS.has(String(key || "").toLowerCase())
  );
  if (disallowedAttrRemove) {
    return { valid: false, reason: `Patch attrRemove not allowed: ${disallowedAttrRemove}.` };
  }

  const hasOps =
    ops.classAdd.length ||
    ops.classRemove.length ||
    Object.keys(ops.classReplace).length ||
    Object.keys(ops.attrAdd).length ||
    ops.attrRemove.length;

  if (!hasOps) {
    return { valid: false, reason: "Patch has no bounded ops." };
  }

  const sanitized = {
    nodeId,
    selector: String(patch.selector || ""),
    stage: patch.stage ? String(patch.stage) : undefined,
    iteration: patch.iteration,
    ops: {
      classAdd: dedupeTokens(ops.classAdd),
      classRemove: dedupeTokens(ops.classRemove),
      classReplace: ops.classReplace,
      attrAdd: ops.attrAdd,
      attrRemove: dedupeTokens(ops.attrRemove),
    },
  };

  return { valid: true, patch: sanitized };
};

const applyPatchOps = (node, ops) => {
  if (!node?.attrs || !ops) return false;

  let tokens = getClassTokens(node.attrs);
  const removeSet = new Set(ops.classRemove);
  tokens = tokens.filter((token) => !removeSet.has(token));

  Object.entries(ops.classReplace).forEach(([from, to]) => {
    const fr = String(from || "").trim();
    const tt = String(to || "").trim();
    if (!fr || !tt) return;
    tokens = tokens.map((token) => (token === fr ? tt : token));
  });

  ops.classAdd.forEach((token) => {
    if (!token) return;
    if (!tokens.includes(token)) tokens.push(token);
  });

  tokens = dedupeTokens(tokens);
  setClassTokens(node.attrs, node.attrOrder, tokens);

  Object.entries(ops.attrAdd).forEach(([key, value]) => {
    const k = String(key || "").trim();
    if (!SAFE_ATTRS.has(k.toLowerCase())) return;
    setAttrValue(node.attrs, node.attrOrder, k, String(value ?? ""));
  });

  ops.attrRemove.forEach((key) => {
    const k = String(key || "").trim();
    if (!SAFE_ATTRS.has(k.toLowerCase())) return;
    removeAttr(node.attrs, node.attrOrder, k);
  });

  return true;
};

const applyPatchPlan = (html, patches) => {
  const source = String(html || "");
  if (!source || !Array.isArray(patches) || !patches.length) return source;

  const nodes = parseHtmlNodes(source);
  const patchesByNode = new Map();

  nodes.forEach((node, index) => {
    if (!node?.attrs) return;
    const nodeId =
      getAttrValue(node.attrs, "data-node-id") || getAttrValue(node.attrs, "data-key");
    if (!nodeId) return;
    if (!patchesByNode.has(String(nodeId))) {
      patchesByNode.set(String(nodeId), index);
    }
  });

  const openTagPatches = [];

  patches.forEach((patch) => {
    const nodeId = String(patch?.nodeId || "").trim();
    if (!nodeId) return;
    const nodeIndex = patchesByNode.get(nodeId);
    if (nodeIndex === undefined) return;
    const node = nodes[nodeIndex];
    const ops = normalizePatchOps(patch);
    if (!ops) return;
    const changed = applyPatchOps(node, ops);
    if (!changed) return;
    openTagPatches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
  });

  return applyPatches(source, openTagPatches);
};

module.exports = {
  SAFE_ATTRS,
  normalizePatchOps,
  validatePatch,
  applyPatchPlan,
};
