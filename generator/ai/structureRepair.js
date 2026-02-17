// generator/ai/structureRepair.js
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlUtils = require(path.resolve(__dirname, "..", "..", "pipeline", "stage.codeit", "contracts", "utils", "html.js"));
const parseHtmlNodes = htmlUtils.parseHtmlNodes;
const getAttrValue = htmlUtils.getAttrValue;

const ALLOWED_OPS = new Set(["wrap", "unwrap", "move", "reorder", "setClasses", "setLayout"]);
const CLASS_TOKEN_RE = /^[^\s<>"'`]+$/;

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function getNodeId(node) {
  if (!node || typeof node !== "object") return "";
  return String(node.id || node.nodeId || node.key || "").trim();
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function buildIndex(root) {
  const map = new Map();
  const parent = new Map();
  const children = new Map();

  function walk(node, parentId = "") {
    const id = getNodeId(node);
    if (!id) return;
    map.set(id, node);
    parent.set(id, parentId || "");
    const kids = asArr(node.children).map((c) => getNodeId(c)).filter(Boolean);
    children.set(id, kids);
    for (const child of asArr(node.children)) walk(child, id);
  }

  walk(root, "");
  return { map, parent, children };
}

function collectSubtreeIds(rootNode) {
  const out = new Set();
  function walk(node) {
    const id = getNodeId(node);
    if (!id || out.has(id)) return;
    out.add(id);
    for (const c of asArr(node.children)) walk(c);
  }
  walk(rootNode);
  return out;
}

function ensureClassTokens(tokens) {
  const bad = [];
  const good = [];
  for (const token of asArr(tokens)) {
    const t = String(token || "").trim();
    if (!t || !CLASS_TOKEN_RE.test(t)) {
      bad.push(t);
      continue;
    }
    good.push(t);
  }
  return { good, bad };
}

function applyClassMutation(node, op) {
  const existing = new Set(asArr(node.classes).map((t) => String(t || "").trim()).filter(Boolean));
  const add = ensureClassTokens(op.classAdd).good;
  const remove = ensureClassTokens(op.classRemove).good;
  const replace = asObj(op.classReplace) || {};

  remove.forEach((t) => existing.delete(t));
  add.forEach((t) => existing.add(t));
  for (const from of Object.keys(replace)) {
    const to = String(replace[from] || "").trim();
    const f = String(from || "").trim();
    if (!f || !to || !CLASS_TOKEN_RE.test(f) || !CLASS_TOKEN_RE.test(to)) continue;
    if (existing.has(f)) {
      existing.delete(f);
      existing.add(to);
    }
  }
  node.classes = Array.from(existing);
}

function findNodeAndParent(root, targetId) {
  if (!root || !targetId) return { node: null, parent: null, parentArr: null, index: -1 };
  let found = { node: null, parent: null, parentArr: null, index: -1 };

  function walk(node, parent) {
    if (found.node) return;
    const kids = asArr(node.children);
    for (let i = 0; i < kids.length; i += 1) {
      const c = kids[i];
      const id = getNodeId(c);
      if (id === targetId) {
        found = { node: c, parent: node, parentArr: kids, index: i };
        return;
      }
      walk(c, node);
      if (found.node) return;
    }
  }

  if (getNodeId(root) === targetId) {
    return { node: root, parent: null, parentArr: null, index: -1 };
  }
  walk(root, null);
  return found;
}

function validateScriptShape(script) {
  const s = asObj(script);
  if (!s) return { ok: false, error: "Script must be object" };
  if (Number(s.version || 0) !== 1) return { ok: false, error: "Script version must be 1" };
  if (!String(s.targetRootId || "").trim()) return { ok: false, error: "Missing targetRootId" };
  if (!Array.isArray(s.ops)) return { ok: false, error: "ops must be array" };
  if (s.ops.length === 0) return { ok: false, error: "ops empty" };
  for (const op of s.ops) {
    const t = String(op?.op || "").trim();
    if (!ALLOWED_OPS.has(t)) return { ok: false, error: `Unsupported op: ${t}` };
  }
  return { ok: true };
}

export function applyStructureEdits(astInput, scriptInput) {
  const ast = clone(astInput);
  const script = clone(scriptInput);
  const shape = validateScriptShape(script);
  if (!shape.ok) throw new Error(`applyStructureEdits: ${shape.error}`);
  if (!asObj(ast) || !asObj(ast.tree)) throw new Error("applyStructureEdits: invalid ast");

  const root = ast.tree;
  const targetRootId = String(script.targetRootId || "").trim();
  const targetInfo = findNodeAndParent(root, targetRootId);
  if (!targetInfo.node && getNodeId(root) !== targetRootId) {
    throw new Error(`applyStructureEdits: targetRootId not found (${targetRootId})`);
  }
  const targetRoot = targetInfo.node || root;
  const allowedIds = collectSubtreeIds(targetRoot);

  function assertInside(id, fieldName) {
    const v = String(id || "").trim();
    if (!v) throw new Error(`applyStructureEdits: missing ${fieldName}`);
    if (!allowedIds.has(v)) throw new Error(`applyStructureEdits: ${fieldName} outside target subtree (${v})`);
  }

  const appliedOps = [];
  let wrapCounter = 0;
  for (const op of script.ops) {
    const kind = String(op.op || "").trim();

    if (kind === "setClasses") {
      assertInside(op.nodeId, "nodeId");
      const info = findNodeAndParent(root, String(op.nodeId));
      const node = info.node || (getNodeId(root) === String(op.nodeId) ? root : null);
      if (!node) throw new Error(`setClasses: node not found (${op.nodeId})`);
      applyClassMutation(node, op);
      appliedOps.push(op);
      continue;
    }

    if (kind === "setLayout") {
      assertInside(op.nodeId, "nodeId");
      const info = findNodeAndParent(root, String(op.nodeId));
      const node = info.node || (getNodeId(root) === String(op.nodeId) ? root : null);
      if (!node) throw new Error(`setLayout: node not found (${op.nodeId})`);
      const add = [];
      const remove = [];
      const layout = String(op.layout || "").trim();
      if (layout === "grid") {
        add.push("grid");
        remove.push("flex", "flex-row", "flex-col");
      } else if (layout === "flex-row") {
        add.push("flex", "flex-row");
        remove.push("grid", "flex-col");
      } else if (layout === "flex-col") {
        add.push("flex", "flex-col");
        remove.push("grid", "flex-row");
      }
      if (op.gap) add.push(String(op.gap));
      const align = asArr(op.align).map(String);
      add.push(...align);
      if (op.columns) add.push(String(op.columns));
      applyClassMutation(node, { classAdd: add, classRemove: remove, classReplace: {} });
      appliedOps.push(op);
      continue;
    }

    if (kind === "reorder") {
      assertInside(op.parentId, "parentId");
      const parentInfo = findNodeAndParent(root, String(op.parentId));
      const parentNode = parentInfo.node || (getNodeId(root) === String(op.parentId) ? root : null);
      if (!parentNode) throw new Error(`reorder: parent not found (${op.parentId})`);
      const kids = asArr(parentNode.children);
      const oldIds = kids.map((c) => getNodeId(c)).filter(Boolean);
      const newIds = asArr(op.childIds).map((x) => String(x || "").trim()).filter(Boolean);
      oldIds.forEach((id) => assertInside(id, "childIds"));
      newIds.forEach((id) => assertInside(id, "childIds"));
      const oldSet = new Set(oldIds);
      const newSet = new Set(newIds);
      if (oldIds.length !== newIds.length || oldSet.size !== newSet.size) {
        throw new Error("reorder: childIds must include exactly existing children");
      }
      for (const id of oldSet) {
        if (!newSet.has(id)) throw new Error("reorder: childIds mismatch");
      }
      const byId = new Map(kids.map((c) => [getNodeId(c), c]));
      parentNode.children = newIds.map((id) => byId.get(id)).filter(Boolean);
      appliedOps.push(op);
      continue;
    }

    if (kind === "move") {
      assertInside(op.nodeId, "nodeId");
      assertInside(op.newParentId, "newParentId");
      const nodeId = String(op.nodeId || "").trim();
      const newParentId = String(op.newParentId || "").trim();
      const moving = findNodeAndParent(root, nodeId);
      const newParentInfo = findNodeAndParent(root, newParentId);
      const node = moving.node || (getNodeId(root) === nodeId ? root : null);
      const newParent = newParentInfo.node || (getNodeId(root) === newParentId ? root : null);
      if (!node || !newParent) throw new Error("move: node/newParent missing");
      if (!moving.parentArr) throw new Error("move: cannot move root");
      // cycle guard
      const desc = collectSubtreeIds(node);
      if (desc.has(newParentId)) throw new Error("move: cycle detected");

      moving.parentArr.splice(moving.index, 1);
      const pos = asObj(op.position) || { type: "append" };
      const type = String(pos.type || "append").trim();
      if (type === "append") {
        newParent.children = asArr(newParent.children);
        newParent.children.push(node);
      } else {
        const refId = String(pos.refId || "").trim();
        assertInside(refId, "position.refId");
        const arr = asArr(newParent.children);
        const idx = arr.findIndex((c) => getNodeId(c) === refId);
        if (idx < 0) throw new Error("move: refId not found in newParent");
        const insertAt = type === "before" ? idx : idx + 1;
        arr.splice(insertAt, 0, node);
        newParent.children = arr;
      }
      appliedOps.push(op);
      continue;
    }

    if (kind === "wrap") {
      assertInside(op.parentId, "parentId");
      const parentId = String(op.parentId || "").trim();
      const parentInfo = findNodeAndParent(root, parentId);
      const parentNode = parentInfo.node || (getNodeId(root) === parentId ? root : null);
      if (!parentNode) throw new Error("wrap: parent not found");
      const childIds = asArr(op.childIds).map((x) => String(x || "").trim()).filter(Boolean);
      if (!childIds.length) throw new Error("wrap: childIds empty");
      childIds.forEach((id) => assertInside(id, "childIds"));
      const arr = asArr(parentNode.children);
      const idxs = childIds.map((id) => arr.findIndex((c) => getNodeId(c) === id));
      if (idxs.some((i) => i < 0)) throw new Error("wrap: one or more children not found");
      const sorted = [...idxs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i] !== sorted[i - 1] + 1) throw new Error("wrap: childIds must be contiguous siblings");
      }
      const start = sorted[0];
      const count = sorted.length;
      const moved = arr.splice(start, count);
      const wrapper = asObj(op.wrapper) || {};
      const wrapperTag = /^(div|section)$/.test(String(wrapper.tag || "")) ? String(wrapper.tag) : "div";
      const wrapperId = `ai-wrap-${Date.now()}-${wrapCounter++}`;
      const wrapperNode = {
        id: wrapperId,
        name: "AI Wrapper",
        type: "FRAME",
        tag: wrapperTag,
        classes: ensureClassTokens(wrapper.classAdd).good,
        children: moved,
      };
      arr.splice(start, 0, wrapperNode);
      parentNode.children = arr;
      // add wrapper to allowed edits for subsequent ops in same script
      allowedIds.add(wrapperId);
      appliedOps.push(op);
      continue;
    }

    if (kind === "unwrap") {
      assertInside(op.nodeId, "nodeId");
      const nodeId = String(op.nodeId || "").trim();
      const info = findNodeAndParent(root, nodeId);
      if (!info.node || !info.parentArr) throw new Error("unwrap: node not found or is root");
      const kids = asArr(info.node.children);
      info.parentArr.splice(info.index, 1, ...kids);
      appliedOps.push(op);
      continue;
    }
  }

  // validation after apply
  const idx = buildIndex(root);
  const uniqueIds = new Set();
  for (const id of idx.map.keys()) {
    if (uniqueIds.has(id)) throw new Error(`applyStructureEdits: duplicate node id after apply (${id})`);
    uniqueIds.add(id);
  }

  return { ast, appliedOps, targetRootId };
}

export function extractSubtreeHtmlByNodeId(html, targetRootId) {
  const source = String(html || "");
  const nodes = parseHtmlNodes(source);
  const target = nodes.find((n) => {
    const dataNodeId = String(getAttrValue(n.attrs, "data-node-id") || "").trim();
    const dataNode = String(getAttrValue(n.attrs, "data-node") || "").trim();
    return dataNodeId === targetRootId || dataNode === targetRootId;
  });
  if (!target) return "";
  const start = Number(target.start || target.openStart || 0);
  const end = Number(target.end || target.openEnd || start);
  if (end <= start) return "";
  return source.slice(start, end);
}

export function buildSubtreeTreeView(ast, targetRootId, maxNodes = 80) {
  const root = asObj(ast?.tree);
  if (!root) return [];
  const target = (() => {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      if (getNodeId(n) === targetRootId) return n;
      const kids = asArr(n.children);
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
    }
    return null;
  })();
  if (!target) return [];

  const out = [];
  const queue = [target];
  while (queue.length && out.length < maxNodes) {
    const n = queue.shift();
    const id = getNodeId(n);
    const kids = asArr(n.children);
    out.push({
      id,
      type: String(n?.type || n?.tag || "").trim(),
      key: String(n?.key || n?.name || "").trim(),
      classTokens: asArr(n?.classes).map((t) => String(t || "").trim()).filter(Boolean),
      children: kids.map((c) => getNodeId(c)).filter(Boolean),
      bbox: n?.bbox || null,
    });
    kids.forEach((c) => queue.push(c));
  }
  return out;
}
