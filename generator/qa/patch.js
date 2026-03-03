// generator/qa/patch.js — Class-only patch engine: add/remove/replace by targetKey, reversible stack

import fs from "node:fs";
import path from "node:path";

/** Patch op: classAdd | classRemove | classReplace */
export function createPatch({ targetKey, op, classes }) {
  const c = Array.isArray(classes) ? classes.map((x) => String(x || "").trim()).filter(Boolean) : [];
  return { targetKey: String(targetKey || "").trim(), op: String(op || "classAdd").trim(), classes: c };
}

/**
 * Resolve targetKey (data-key or nodeId) to nodeId from layout.
 */
export function resolveToNodeId(layout, targetKey) {
  if (!layout || !Array.isArray(layout)) return null;
  const key = String(targetKey || "").trim();
  if (!key) return null;
  for (const el of layout) {
    const dk = String(el?.dataKey ?? "").trim();
    const id = String(el?.nodeId ?? "").trim();
    if (dk === key || id === key) return id || null;
  }
  return null;
}

/**
 * Merge a single patch into patches map (keyed by nodeId).
 * Map format: { [nodeId]: { classAdd?: string[], classRemove?: string[], classReplace?: Record<string,string> } }
 */
export function mergePatchIntoMap(patchesMap, patch, nodeId) {
  const map = patchesMap && typeof patchesMap === "object" ? patchesMap : {};
  const id = String(nodeId || "").trim();
  if (!id) return map;

  const entry = map[id] || {};
  const next = { ...entry };

  if (patch.op === "classAdd" && patch.classes?.length) {
    const add = [...(next.classAdd || []), ...patch.classes];
    next.classAdd = [...new Set(add)];
  }
  if (patch.op === "classRemove" && patch.classes?.length) {
    const remove = [...(next.classRemove || []), ...patch.classes];
    next.classRemove = [...new Set(remove)];
  }
  if (patch.op === "classReplace" && patch.classes?.length) {
    const replace = { ...(next.classReplace || {}) };
    for (let i = 0; i < patch.classes.length - 1; i += 2) {
      replace[patch.classes[i]] = patch.classes[i + 1];
    }
    next.classReplace = replace;
  }

  return { ...map, [id]: next };
}

/**
 * Apply a list of patches (with nodeId resolved) to a patches map.
 */
export function applyPatchesToMap(patchesMap, patchesWithNodeId) {
  let map = patchesMap || {};
  for (const { patch, nodeId } of patchesWithNodeId) {
    if (!nodeId) continue;
    map = mergePatchIntoMap(map, patch, nodeId);
  }
  return map;
}

/**
 * Idempotent: applying the same classAdd twice doesn't duplicate (Set).
 * classRemove: same. classReplace: last wins.
 */
export function mergePatchesMap(base, override) {
  const out = { ...(base && typeof base === "object" ? base : {}) };
  const ov = override && typeof override === "object" ? override : {};
  for (const [nodeId, entry] of Object.entries(ov)) {
    const cur = out[nodeId] || {};
    const add = [...new Set([...(cur.classAdd || []), ...(entry.classAdd || [])])];
    const remove = [...new Set([...(cur.classRemove || []), ...(entry.classRemove || [])])];
    const replace = { ...(cur.classReplace || {}), ...(entry.classReplace || {}) };
    out[nodeId] = { classAdd: add, classRemove: remove, classReplace: replace };
  }
  return out;
}

/**
 * Write patches to fixtures.out/<slug>/patches.json (or custom outDir/patches.json).
 */
export function writePatchesFile(outDir, patchesMap) {
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, "patches.json");
  const data = patchesMap && typeof patchesMap === "object" ? patchesMap : {};
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
  return filepath;
}

/**
 * Read existing patches from outDir.
 */
export function readPatchesFile(outDir) {
  const filepath = path.join(outDir, "patches.json");
  if (!fs.existsSync(filepath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Rollback: replace patches file with previous snapshot.
 */
export function rollbackPatchesFile(outDir, previousMap) {
  return writePatchesFile(outDir, previousMap || {});
}
