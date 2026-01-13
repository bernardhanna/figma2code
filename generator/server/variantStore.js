// generator/server/variantStore.js
//
// Variant storage + overlay materialization
// - Canonical group dir: fixtures.out/<slugified-groupKey>/
// - Stores ASTs as:      ast.<variant>.json
// - Stores overlays as:  figma.<variant>.png
//
// Materialization supports:
// - data:image/png;base64,...
// - /assets/... (requires serverUrl, e.g. http://127.0.0.1:5173)
// - http(s)://...png
//
// IMPORTANT:
// - We ALWAYS write overlays to the canonical dir so the preview/compare stack
//   can reliably link: /fixtures.out/<canonical>/figma.<variant>.png
//

import fs from "node:fs";
import path from "node:path";

import { VDIFF_DIR } from "./runtimePaths.js";
import { isValidVariant } from "./variantNaming.js";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function slugifyGroupKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/i, "") // drop @mobile/@desktop etc if present
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Legacy dir used to be raw groupKey (could contain spaces)
function legacyGroupDir(groupKey) {
  return path.join(VDIFF_DIR, String(groupKey || "").trim());
}

export function groupDir(groupKey) {
  // Canonical dir (slug-safe)
  return path.join(VDIFF_DIR, slugifyGroupKey(groupKey));
}

function resolveExistingGroupDir(groupKey) {
  const canonical = groupDir(groupKey);
  if (fs.existsSync(canonical)) return canonical;

  const legacy = legacyGroupDir(groupKey);
  if (fs.existsSync(legacy)) return legacy;

  // Default to canonical for new writes
  return canonical;
}

export function variantAstPath(groupKey, variant) {
  return path.join(groupDir(groupKey), `ast.${variant}.json`);
}


export function variantFigmaPath(groupKey, variant) {
  // ALWAYS write overlays into canonical folder so preview can find:
  // /fixtures.out/<canonical>/figma.<variant>.png
  return path.join(groupDir(groupKey), `figma.${variant}.png`);
}

export function writeVariantAst(groupKey, variant, ast) {
  if (!groupKey) throw new Error("writeVariantAst: missing groupKey");
  if (!isValidVariant(variant)) throw new Error(`writeVariantAst: invalid variant "${variant}"`);

  // Always write under canonical dir
  const dir = groupDir(groupKey);
  ensureDir(dir);

  const outPath = path.join(dir, `ast.${variant}.json`);
  fs.writeFileSync(outPath, JSON.stringify(ast, null, 2), "utf8");

  return outPath;
}

/**
 * Materialize an overlay into /fixtures.out/<canonical>/figma.<variant>.png whenever possible.
 *
 * Supported overlaySrc:
 * - data:image/png;base64,...
 * - /assets/xyz.png (served by your dev server)
 * - http(s)://...png
 *
 * If it can be written locally, returns the fixtures URL:
 *   /fixtures.out/<canonical>/figma.<variant>.png
 * Otherwise returns the original src unchanged.
 *
 * NOTE: serverUrl is optional, but REQUIRED if overlaySrc is a relative URL like "/assets/...".
 */
export async function materializeOverlayIfPossible({ groupKey, variant, overlaySrc, serverUrl }) {
  const src = String(overlaySrc || "").trim();
  if (!src) return "";

  if (!groupKey) throw new Error("materializeOverlayIfPossible: missing groupKey");
  if (!isValidVariant(variant)) {
    throw new Error(`materializeOverlayIfPossible: invalid variant "${variant}"`);
  }

  const canonical = slugifyGroupKey(groupKey);
  const dir = groupDir(groupKey);
  ensureDir(dir);

  const outPath = variantFigmaPath(groupKey, variant);
  const publicUrl = `/fixtures.out/${encodeURIComponent(canonical)}/figma.${variant}.png`;

  // 1) data URL
  const m = src.match(/^data:image\/png;base64,(.+)$/i);
  if (m) {
    const buf = Buffer.from(m[1], "base64");
    fs.writeFileSync(outPath, buf);
    return publicUrl;
  }

  // 2) If already materialized, do not re-download
  if (fs.existsSync(outPath)) return publicUrl;

  // 3) Remote or relative URL -> fetch to file
  const isHttp = /^https?:\/\//i.test(src);
  const isRel = src.startsWith("/");

  if (isHttp || isRel) {
    const base = String(serverUrl || "").trim().replace(/\/+$/g, "");
    if (isRel && !base) {
      // Cannot resolve "/assets/..." without a server base
      return src;
    }

    const url = isHttp ? src : `${base}${src}`;

    try {
      const r = await fetch(url);
      if (!r.ok) return src;

      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(outPath, buf);
      return publicUrl;
    } catch {
      // Keep pipeline resilient; fall back to using original src
      return src;
    }
  }

  // 4) Unknown scheme (leave untouched)
  return src;
}

/**
 * Legacy helper: only materializes data URLs (sync).
 * Prefer materializeOverlayIfPossible(...) for /assets or http(s) sources.
 */
export function materializeOverlayIfDataUrl({ groupKey, variant, overlaySrc }) {
  const src = String(overlaySrc || "").trim();
  if (!src) return "";

  const m = src.match(/^data:image\/png;base64,(.+)$/i);
  if (!m) return src;

  if (!groupKey) throw new Error("materializeOverlayIfDataUrl: missing groupKey");
  if (!isValidVariant(variant)) throw new Error(`materializeOverlayIfDataUrl: invalid variant "${variant}"`);

  const buf = Buffer.from(m[1], "base64");

  const dir = groupDir(groupKey);
  ensureDir(dir);

  const outPath = variantFigmaPath(groupKey, variant);
  fs.writeFileSync(outPath, buf);

  const canonical = slugifyGroupKey(groupKey);
  return `/fixtures.out/${encodeURIComponent(canonical)}/figma.${variant}.png`;
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
  // Prefer canonical (because overlays are always written there)
  const canonicalDir = groupDir(groupKey);
  const dir = fs.existsSync(canonicalDir) ? canonicalDir : resolveExistingGroupDir(groupKey);
  if (!fs.existsSync(dir)) return [];

  const out = [];
  for (const v of ["mobile", "tablet", "desktop"]) {
    const hasAst = fs.existsSync(path.join(dir, `ast.${v}.json`));
    const hasOv = fs.existsSync(path.join(canonicalDir, `figma.${v}.png`)); // overlays always canonical
    if (hasAst || hasOv) out.push(v);
  }
  return out;
}
