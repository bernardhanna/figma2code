// generator/constraints/expected.js
// Compute expected design-space geometry and keyed relationships from AST.

function finite(n) {
  return Number.isFinite(Number(n));
}

function rectFromNode(node, parentAbs) {
  const bb = node && typeof node === "object" ? (node.bb || null) : null;
  if (bb && finite(bb.x) && finite(bb.y) && finite(bb.w ?? bb.width) && finite(bb.h ?? bb.height)) {
    return {
      x: Number(bb.x),
      y: Number(bb.y),
      w: Number(bb.w ?? bb.width),
      h: Number(bb.h ?? bb.height),
    };
  }

  const relX = finite(node?.relX) ? Number(node.relX) : finite(node?.x) ? Number(node.x) : 0;
  const relY = finite(node?.relY) ? Number(node.relY) : finite(node?.y) ? Number(node.y) : 0;
  const w = finite(node?.w) ? Number(node.w) : finite(node?.width) ? Number(node.width) : null;
  const h = finite(node?.h) ? Number(node.h) : finite(node?.height) ? Number(node.height) : null;
  if (!finite(w) || !finite(h) || Number(w) <= 0 || Number(h) <= 0) return null;

  const baseX = parentAbs ? Number(parentAbs.x) : 0;
  const baseY = parentAbs ? Number(parentAbs.y) : 0;
  return { x: baseX + relX, y: baseY + relY, w: Number(w), h: Number(h) };
}

function nodePrimaryKey(node) {
  const k = String(node?.key || "").trim();
  if (k) return k;
  return String(node?.id || "").trim();
}

function addAlias(map, key, value) {
  const k = String(key || "").trim();
  if (!k) return;
  map[k] = value;
}

export function computeExpectedRects(ast) {
  const rects = {};
  const parentRects = {};
  const parentByKey = {};
  const childrenByKey = {};
  const metaByKey = {};

  function walk(node, parentRect, parentKey) {
    if (!node || typeof node !== "object") return;
    const key = nodePrimaryKey(node);
    const nodeId = String(node?.id || "").trim();
    const rect = rectFromNode(node, parentRect || null);
    if (!key && !nodeId) return;

    const aliases = [key, nodeId].filter(Boolean);
    for (const alias of aliases) {
      if (rect) addAlias(rects, alias, { ...rect });
      if (parentRect) addAlias(parentRects, alias, { ...parentRect });
      if (parentKey) addAlias(parentByKey, alias, parentKey);
      addAlias(metaByKey, alias, {
        id: nodeId,
        key: key,
        name: String(node?.name || ""),
        tag: String(node?.tag || ""),
      });
      if (!childrenByKey[alias]) childrenByKey[alias] = [];
    }

    if (parentKey) {
      if (!childrenByKey[parentKey]) childrenByKey[parentKey] = [];
      const childRef = key || nodeId;
      if (childRef && !childrenByKey[parentKey].includes(childRef)) {
        childrenByKey[parentKey].push(childRef);
      }
    }

    const nextParentRect = rect || parentRect || null;
    const nextParentKey = key || nodeId || parentKey || "";
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const child of kids) walk(child, nextParentRect, nextParentKey);
  }

  const root = ast?.tree ?? ast;
  if (root) walk(root, null, "");

  return { rects, parentRects, parentByKey, childrenByKey, metaByKey };
}

