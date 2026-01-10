// generator/server/variantStore.js

import fs from "node:fs";
import path from "node:path";

import { VDIFF_DIR } from "./runtimePaths.js";
import { isValidVariant } from "./variantNaming.js";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function groupDir(groupKey) {
  return path.join(VDIFF_DIR, String(groupKey || "").trim());
}

export function variantAstPath(groupKey, variant) {
  return path.join(groupDir(groupKey), `ast.${variant}.json`);
}

export function variantFigmaPath(groupKey, variant) {
  return path.join(groupDir(groupKey), `figma.${variant}.png`);
}

export function writeVariantAst(groupKey, variant, ast) {
  if (!groupKey) throw new Error("writeVariantAst: missing groupKey");
  if (!isValidVariant(variant)) throw new Error(`writeVariantAst: invalid variant "${variant}"`);

  const dir = groupDir(groupKey);
  ensureDir(dir);

  const outPath = variantAstPath(groupKey, variant);
  fs.writeFileSync(outPath, JSON.stringify(ast, null, 2), "utf8");

  return outPath;
}

/**
 * If overlay src is a data: URL (png), write it to figma.<variant>.png and
 * return a new overlay src pointing to /fixtures.out/<groupKey>/figma.<variant>.png
 * Otherwise, return the original src unchanged.
 */
export function materializeOverlayIfDataUrl({ groupKey, variant, overlaySrc }) {
  const src = String(overlaySrc || "").trim();
  if (!src) return "";

  // Only handle png data URLs (safe + deterministic)
  const m = src.match(/^data:image\/png;base64,(.+)$/i);
  if (!m) return src;

  const b64 = m[1];
  const buf = Buffer.from(b64, "base64");

  const dir = groupDir(groupKey);
  ensureDir(dir);

  const outPath = variantFigmaPath(groupKey, variant);
  fs.writeFileSync(outPath, buf);

  // Public URL (your server already serves /fixtures.out)
  return `/fixtures.out/${encodeURIComponent(groupKey)}/figma.${variant}.png`;
}

export function readVariantAstIfExists(groupKey, variant) {
  const p = variantAstPath(groupKey, variant);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function listAvailableVariants(groupKey) {
  const dir = groupDir(groupKey);
  if (!fs.existsSync(dir)) return [];

  const out = [];
  for (const v of ["mobile", "tablet", "desktop"]) {
    if (fs.existsSync(variantAstPath(groupKey, v))) out.push(v);
  }
  return out;
}
