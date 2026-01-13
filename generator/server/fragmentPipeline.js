// generator/server/fragmentPipeline.js

import fs from "node:fs";
import path from "node:path";

import { PREVIEW_DIR } from "./runtimePaths.js";
import { mergeResponsiveFragments } from "../auto/mergeResponsiveFragments.js";

import { parseGroupVariant } from "./variantNaming.js";
import {
  writeVariantAst,
  readVariantAstIfExists,
  materializeOverlayIfDataUrl,
} from "./variantStore.js";

import { writeStage } from "./stageStore.js";

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

/**
 * If a pass returns { ast: <actualAst>, ... }, unwrap it.
 * If it's already an AST, return it.
 */
function coerceAst(maybeWrapped, fallbackAst = null) {
  if (!maybeWrapped) return fallbackAst;
  if (asObj(maybeWrapped) && asObj(maybeWrapped.ast) && asObj(maybeWrapped.ast.tree)) {
    return maybeWrapped.ast;
  }
  if (asObj(maybeWrapped) && asObj(maybeWrapped.tree)) return maybeWrapped;
  return fallbackAst;
}

/**
 * Normalize pipeline step return shapes.
 * Many passes may return:
 * - ast (direct)
 * - { ast, report, ... }
 */
function unwrapAstResult(out, fallbackAst) {
  if (!out) return { ast: fallbackAst, extra: null };

  // If it looks like { ast: { tree: ... } }
  if (asObj(out) && asObj(out.ast) && asObj(out.ast.tree)) return { ast: out.ast, extra: out };

  // If it looks like a plain AST
  if (asObj(out) && asObj(out.tree)) return { ast: out, extra: null };

  // Unknown shape: fallback
  return { ast: fallbackAst, extra: null };
}

function pickBaseVariant(variantsMap) {
  if (variantsMap.mobile) return "mobile";
  if (variantsMap.tablet) return "tablet";
  if (variantsMap.desktop) return "desktop";
  return "";
}

function compositeAstForMerged({ groupKey, variantsMap }) {
  const baseKey = pickBaseVariant(variantsMap);
  const baseAst = variantsMap[baseKey] || null;
  if (!baseAst) return null;

  // Prefer desktop for sizing/overlay reference if present
  const desktopAst = variantsMap.desktop || null;
  const prefer = desktopAst || baseAst;

  // Merge fonts list (best-effort union)
  const fonts = [];
  const seen = new Set();
  for (const v of ["mobile", "tablet", "desktop"]) {
    const a = variantsMap[v];
    const arr = Array.isArray(a?.meta?.fonts) ? a.meta.fonts : [];
    for (const f of arr) {
      const family = String(f?.family || "").trim();
      if (!family) continue;
      const weights = Array.isArray(f?.weights) ? f.weights : [];
      const key = family + ":" + weights.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      fonts.push(f);
    }
  }

  return {
    ...prefer,
    slug: groupKey,
    meta: {
      ...(prefer.meta || {}),
      fonts: fonts.length ? fonts : prefer.meta?.fonts || [],
      responsive: {
        groupKey,
        variants: ["mobile", "tablet", "desktop"].filter((k) => !!variantsMap[k]),
        base: baseKey,
        mdFrom: variantsMap.tablet ? "tablet" : "",
        lgFrom: variantsMap.desktop ? "desktop" : "",
      },
    },
  };
}

function ensurePreviewDir() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

/**
 * Build a single fragment (legacy path) from one AST using your existing passes.
 * IMPORTANT: applies semanticAccessiblePass() to the rendered HTML fragment.
 */
function renderOneFragment({
  ast,
  autoLayoutify,
  semanticAccessiblePass,
  preventNestedInteractive,
  buildIntentGraph,
  normalizeAst,
}) {
  let a = ast;

  // normalize (robustly unwrap)
  if (normalizeAst) {
    const r = normalizeAst(a);
    const un = unwrapAstResult(r, a);
    a = un.ast || a;
  }

  // intent graph pass
  let phase3 = null;
  if (buildIntentGraph) {
    const r = buildIntentGraph(a);
    const un = unwrapAstResult(r, a);
    a = un.ast;
    phase3 = un.extra || null;
  }

  // Prevent <button> wrapping <button>/<a> etc.
  // This must run after semantics/clickability is assigned.
  if (preventNestedInteractive) {
    const r = preventNestedInteractive(a);
    const un = unwrapAstResult(r, a);
    a = un.ast || a;
  }

  // Guard: ensure we truly have an AST with tree before rendering
  if (!a || !a.tree) {
    throw new Error("renderOneFragment: pipeline produced AST missing tree");
  }

  // render
  const semantics = a?.semantics || a?.semanticsMap || a?.meta?.semantics || {};
  let fragment = autoLayoutify(a, {
    semantics,
    wrap: true,
    fontMap: a?.meta?.fontMap || {},
  });

  // Phase2: semantic + accessible HTML edits
  let phase2Report = null;
  if (semanticAccessiblePass) {
    const out = semanticAccessiblePass({ html: fragment, ast: a, semantics });
    if (out && typeof out.html === "string") fragment = out.html;
    phase2Report = out?.report || null;
  }

  return {
    ast: a,
    fragment,
    phase3,
    phase2Report,
    phase2NormalizedPath: null,
  };
}

/**
 * Load stored variants for a groupKey and return a variantsMap {mobile,tablet,desktop}.
 * Coerces any wrapped shapes into plain ASTs.
 */
export function loadVariantsForGroup(groupKey) {
  const m0 = readVariantAstIfExists(groupKey, "mobile");
  const t0 = readVariantAstIfExists(groupKey, "tablet");
  const d0 = readVariantAstIfExists(groupKey, "desktop");

  const variantsMap = {
    mobile: coerceAst(m0, null),
    tablet: coerceAst(t0, null),
    desktop: coerceAst(d0, null),
  };

  const available = Object.entries(variantsMap)
    .filter(([, v]) => !!v)
    .map(([k]) => k);

  return { variantsMap, available };
}

/**
 * Build merged responsive fragment for groupKey from stored variant ASTs.
 * IMPORTANT: runs semanticAccessiblePass on each variant fragment BEFORE merging.
 */
export function buildMergedResponsivePreview({
  groupKey,
  autoLayoutify,
  semanticAccessiblePass,
  previewHtml,
}) {
  const { variantsMap, available } = loadVariantsForGroup(groupKey);

  if (!available.length) {
    return { ok: false, status: 404, error: `No variants found for "${groupKey}".` };
  }

  const baseVariant = pickBaseVariant(variantsMap);
  const baseAst = variantsMap[baseVariant];
  if (!baseAst?.tree) {
    return { ok: false, status: 500, error: `No base AST (with tree) found for "${groupKey}".` };
  }

  const mobileAst = variantsMap.mobile || null;
  const tabletAst = variantsMap.tablet || null;
  const desktopAst = variantsMap.desktop || null;

  const phase2Reports = {};

  function renderVariant(ast) {
    if (!ast) return "";
    const semantics = ast?.semantics || ast?.semanticsMap || ast?.meta?.semantics || {};
    let html = autoLayoutify(ast, {
      semantics,
      wrap: true,
      fontMap: ast?.meta?.fontMap || {},
    });

    if (semanticAccessiblePass) {
      const out = semanticAccessiblePass({ html, ast, semantics });
      if (out && typeof out.html === "string") html = out.html;
      phase2Reports[ast?.meta?.responsive?.variant || ast?.slug || "variant"] = out?.report || null;
    }
    return html;
  }

  // Ensure we label variant reports deterministically
  if (mobileAst) mobileAst.meta = { ...(mobileAst.meta || {}), responsive: { ...(mobileAst.meta?.responsive || {}), variant: "mobile" } };
  if (tabletAst) tabletAst.meta = { ...(tabletAst.meta || {}), responsive: { ...(tabletAst.meta?.responsive || {}), variant: "tablet" } };
  if (desktopAst) desktopAst.meta = { ...(desktopAst.meta || {}), responsive: { ...(desktopAst.meta?.responsive || {}), variant: "desktop" } };

  const mobileHtml = renderVariant(mobileAst);
  const tabletHtml = renderVariant(tabletAst);
  const desktopHtml = renderVariant(desktopAst);

  const mergedFragment = mergeResponsiveFragments({ mobileHtml, tabletHtml, desktopHtml });

  const mergedAst = compositeAstForMerged({ groupKey, variantsMap });
  if (!mergedAst?.tree) {
    return { ok: false, status: 500, error: `Failed to build merged AST for "${groupKey}".` };
  }

  // Stage merged ast for compare/autofix
  writeStage(groupKey, mergedAst);

  const preview = previewHtml(mergedAst, { fragment: mergedFragment });

  return {
    ok: true,
    ast: mergedAst,
    fragment: mergedFragment,
    preview,
    availableVariants: available,
    baseVariant,
    phase2Reports,
  };
}

/**
 * Primary entry for /api/preview-only and /api/generate.
 */
export async function buildPreviewFragment({
  astInput,
  normalizeAst,
  buildIntentGraph,
  autoLayoutify,
  semanticAccessiblePass,
  preventNestedInteractive,
  previewHtml,
}) {
  try {
    if (!astInput || !astInput.tree) {
      return { ok: false, status: 400, error: "Missing tree in payload" };
    }

    const nameSource =
      String(astInput?.slug || "").trim() ||
      String(astInput?.meta?.figma?.frameName || "").trim() ||
      String(astInput?.meta?.frameName || "").trim();

    const parsed = parseGroupVariant(nameSource);

    ensurePreviewDir();

    // ---------------- Variant mode ----------------
    if (parsed.isVariant) {
      const groupKey = parsed.groupKey;
      const variant = parsed.variant;

      const single = renderOneFragment({
        ast: { ...astInput, slug: groupKey },
        autoLayoutify,
        semanticAccessiblePass,
        preventNestedInteractive,
        buildIntentGraph,
        normalizeAst,
      });

      let variantAst = single.ast;

      // Materialize overlay if it is a data URL
      const overlaySrc = String(variantAst?.meta?.overlay?.src || "").trim();
      if (overlaySrc) {
        const newSrc = materializeOverlayIfDataUrl({
          groupKey,
          variant,
          overlaySrc,
        });

        if (newSrc && newSrc !== overlaySrc) {
          variantAst = {
            ...variantAst,
            meta: {
              ...(variantAst.meta || {}),
              overlay: {
                ...(variantAst.meta?.overlay || {}),
                src: newSrc,
              },
            },
          };
        }
      }

      // Override immediately
      writeVariantAst(groupKey, variant, variantAst);

      // Rebuild merged preview (WITH semantic pass applied per-variant)
      const merged = buildMergedResponsivePreview({
        groupKey,
        autoLayoutify,
        semanticAccessiblePass,
        previewHtml,
      });

      if (!merged.ok) return merged;

      // Write preview file for /preview/:groupKey
      const previewOut = path.join(PREVIEW_DIR, `${groupKey}.html`);
      fs.writeFileSync(previewOut, merged.preview, "utf8");

      return {
        ok: true,
        ast: merged.ast,
        fragment: merged.fragment,
        preview: merged.preview,

        // Single variant's phase2 is still useful to surface
        phase2Report: single.phase2Report || null,
        phase2Reports: merged.phase2Reports || null,
        phase2NormalizedPath: single.phase2NormalizedPath || null,
        phase3IntentPath: null,
        rasterCtaOffenders: null,
        phase3: single.phase3 || null,

        responsive: {
          groupKey,
          variantSaved: variant,
          availableVariants: merged.availableVariants,
          baseVariant: merged.baseVariant,
        },
      };
    }

    // ---------------- Legacy mode ----------------
    const single = renderOneFragment({
      ast: astInput,
      autoLayoutify,
      semanticAccessiblePass,
      preventNestedInteractive,
      buildIntentGraph,
      normalizeAst,
    });

    writeStage(single.ast.slug, single.ast);

    const preview = previewHtml(single.ast, { fragment: single.fragment });

    return {
      ok: true,
      ast: single.ast,
      fragment: single.fragment,
      preview,

      phase2Report: single.phase2Report || null,
      phase2NormalizedPath: single.phase2NormalizedPath || null,
      phase3IntentPath: null,
      rasterCtaOffenders: null,
      phase3: single.phase3 || null,
    };
  } catch (e) {
    return { ok: false, status: 500, error: String(e?.message || e) };
  }
}
