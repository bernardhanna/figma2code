// generator/qa/expected.js — Extract expected bounding rects from AST (design-space)

import fs from "node:fs";
import path from "node:path";

/**
 * Get bounding box from AST node: node.bb / node.bbox or node.x,y,w,h.
 */
function nodeBox(node) {
  if (!node || typeof node !== "object") return null;
  const bb = node.bb || node.bbox || null;
  if (bb) {
    const x = Number(bb.x);
    const y = Number(bb.y);
    const w = Number(bb.w ?? bb.width);
    const h = Number(bb.h ?? bb.height);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const x = Number(node.x);
  const y = Number(node.y);
  const w = Number(node.w ?? node.width);
  const h = Number(node.h ?? node.height);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { x, y, w, h };
  }
  return null;
}

/**
 * Stable key for AST node: node.key (e.g. "instance:button#1") or node.id.
 */
function nodeKey(node) {
  if (!node) return "";
  const k = String(node.key ?? "").trim();
  if (k) return k;
  return String(node.id ?? "").trim();
}

/**
 * Walk tree and collect expected rects (design native size).
 * Stores by both node.key and node.id so layout (data-key or data-node-id) can resolve.
 * Returns { rects: { [key]: { x, y, w, h } }, parentRects: { [key]: { x, y, w, h } } }.
 */
export function expectedRectsFromAst(ast) {
  const rects = {};
  const parentRects = {};

  function walk(node, parentBox) {
    if (!node) return;
    const key = nodeKey(node);
    const id = String(node.id ?? "").trim();
    const box = nodeBox(node);
    if (box) {
      if (key) rects[key] = { ...box };
      if (id) rects[id] = { ...box };
    }
    if (parentBox) {
      if (key) parentRects[key] = { ...parentBox };
      if (id) parentRects[id] = { ...parentBox };
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walk(child, box || parentBox);
    }
  }

  const tree = ast?.tree ?? ast;
  if (tree) walk(tree, null);

  return { rects, parentRects };
}

/**
 * Write expected-rects.json to outDir (design-space rects + parent rects).
 */
export function writeExpectedRects(ast, outDir) {
  const { rects, parentRects } = expectedRectsFromAst(ast);
  const payload = { rects, parentRects, at: new Date().toISOString() };
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, "expected-rects.json");
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf8");
  return filepath;
}
