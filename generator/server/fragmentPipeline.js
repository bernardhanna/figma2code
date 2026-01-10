// generator/server/fragmentPipeline.js

import fs from "node:fs";
import path from "node:path";

import { PREVIEW_DIR } from "./runtimePaths.js";
import { parseGroupVariant } from "./variantNaming.js";
import { writeVariantAst, readVariantAstIfExists, listAvailableVariants, materializeOverlayIfDataUrl } from "./variantStore.js";
import { mergeResponsiveFragments } from "../auto/mergeResponsiveFragments.js";
import { writeStage } from "./stageStore.js";

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

/**
 * Normalize pipeline step return shapes.
 * Many of your passes may return:
 * - ast (direct)
 * - { ast, report, ... }
 */
function unwrapAstResult(out, fallbackAst) {
  if (!out) return { ast: fallbackAst, extra: null };
  if (asObj(out) && asObj(out.ast)) return { ast: out.ast, extra: out };
  if (asObj(out)) return { ast: out, extra: null };
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

  // For sizing & overlay: prefer desktop (if exists) for designW/overlay reference,
  // otherwise fall back to base.
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
      const key = family + ":" + (Array.isArray(f?.weights) ? f.weights.join(",") : "");
      if (seen.has(key)) continue;
      seen.add(key);
      fonts.push(f);
    }
  }

  const out = {
    ...prefer,
    slug: groupKey,
    // keep tree/frame from prefer (desktop if present)
    meta: {
      ...(prefer.meta || {}),
      fonts: fonts.length ? fonts : (prefer.meta?.fonts || []),
      // Also preserve an indicator this is merged
      responsive: {
        groupKey,
        variants: Object.keys(variantsMap).filter((k) => !!variantsMap[k]),
        base: baseKey,
        mdFrom: variantsMap.tablet ? "tablet" : "",
        lgFrom: variantsMap.desktop ? "desktop" : "",
      },
    },
  };

  return out;
}

function ensurePreviewDir() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

/**
 * Build a single fragment (legacy path) from one AST.
 */
function renderOneFragment({ ast, autoLayoutify, semanticAccessiblePass, buildIntentGraph, normalizeAst }) {
  let a = ast;

  // normalize
  if (normalizeAst) {
    const r = normalizeAst(a);
    a = r || a;
  }

  // intent graph pass
  let phase3 = null;
  if (buildIntentGraph) {
    const r = buildIntentGraph(a);
    const un = unwrapAstResult(r, a);
    a = un.ast;
    phase3 = un.extra || null;
  }

  // semantic pass
  let phase2Report = null;
  let phase2NormalizedPath = null;
  if (semanticAccessiblePass) {
    const r = semanticAccessiblePass(a);
    const un = unwrapAstResult(r, a);
    a = un.ast;
    phase2Report = un.extra?.report || un.extra?.phase2Report || null;
  }

  // render
  const semantics = a?.semantics || a?.semanticsMap || a?.meta?.semantics || {};
  const fragment = autoLayoutify(a, { semantics, wrap: true, fontMap: a?.meta?.fontMap || {} });

  return {
    ast: a,
    fragment,
    phase3,
    phase2Report,
    phase2NormalizedPath,
  };
}

/**
 * Load stored variants for a groupKey and return a variantsMap {mobile,tablet,desktop}.
 */
export function loadVariantsForGroup(groupKey) {
  const variantsMap = {
    mobile: readVariantAstIfExists(groupKey, "mobile"),
    tablet: readVariantAstIfExists(groupKey, "tablet"),
    desktop: readVariantAstIfExists(groupKey, "desktop"),
  };

  const available = Object.entries(variantsMap)
    .filter(([, v]) => !!v)
    .map(([k]) => k);

  return { variantsMap, available };
}

/**
 * Build merged responsive fragment for groupKey from stored variant ASTs.
 */
export function buildMergedResponsivePreview({ groupKey, autoLayoutify, previewHtml }) {
  const { variantsMap, available } = loadVariantsForGroup(groupKey);
  if (!available.length) {
    return { ok: false, status: 404, error: `No variants found for "${groupKey}".` };
  }

  const baseVariant = pickBaseVariant(variantsMap);
  const baseAst = variantsMap[baseVariant];

  const tabletAst = variantsMap.tablet || null;
  const desktopAst = variantsMap.desktop || null;

  // Render fragments separately, but without wrappers duplication in merge output?
  // We merge at HTML string level, so keep wrappers consistent.
  // NOTE: autoLayoutify currently returns FULL <section> wrapper when wrap=true.
  // For merge to behave, we need fragments of the same "shape". We'll set wrap=true.
  // The merge operates on tags containing data-node/data-key.
  const semanticsBase = baseAst?.semantics || baseAst?.semanticsMap || {};
  const semanticsTablet = tabletAst?.semantics || tabletAst?.semanticsMap || {};
  const semanticsDesktop = desktopAst?.semantics || desktopAst?.semanticsMap || {};

  const mobileHtml = variantsMap.mobile
    ? autoLayoutify(variantsMap.mobile, { semantics: semanticsBase, wrap: true, fontMap: variantsMap.mobile?.meta?.fontMap || {} })
    : "";

  const tabletHtml = tabletAst
    ? autoLayoutify(tabletAst, { semantics: semanticsTablet, wrap: true, fontMap: tabletAst?.meta?.fontMap || {} })
    : "";

  const desktopHtml = desktopAst
    ? autoLayoutify(desktopAst, { semantics: semanticsDesktop, wrap: true, fontMap: desktopAst?.meta?.fontMap || {} })
    : "";

  const merged = mergeResponsiveFragments({ mobileHtml, tabletHtml, desktopHtml });

  const mergedAst = compositeAstForMerged({ groupKey, variantsMap });

  // Stage merged ast for compare/autofix
  writeStage(groupKey, mergedAst);

  const preview = previewHtml(mergedAst, { fragment: merged });

  return {
    ok: true,
    ast: mergedAst,
    fragment: merged,
    preview,
    availableVariants: available,
    baseVariant,
  };
}

/**
 * Primary entry for /api/preview-only and /api/generate.
 * - If input slug/frameName uses groupKey@variant:
 *    - normalize/passes/run on this variant AST
 *    - materialize overlay if data: URL
 *    - write fixtures.out/<groupKey>/ast.<variant>.json (override immediately)
 *    - rebuild merged preview for groupKey
 * - Else:
 *    - legacy build of single preview for ast.slug
 */
export async function buildPreviewFragment({
  astInput,
  normalizeAst,
  buildIntentGraph,
  autoLayoutify,
  semanticAccessiblePass,
  previewHtml,
}) {
  try {
    if (!astInput || !astInput.tree) {
      return { ok: false, status: 400, error: "Missing tree in payload" };
    }

    // Determine naming source: explicit slug OR figma frame name
    const nameSource =
      String(astInput?.slug || "").trim() ||
      String(astInput?.meta?.figma?.frameName || "").trim() ||
      String(astInput?.meta?.frameName || "").trim();

    const parsed = parseGroupVariant(nameSource);

    // Always ensure preview dir exists
    ensurePreviewDir();

    // Variant mode
    if (parsed.isVariant) {
      const groupKey = parsed.groupKey;
      const variant = parsed.variant;

      // Build the variant AST through your existing pipeline steps (normalize + passes)
      const single = renderOneFragment({
        ast: {
          ...astInput,
          // slug should be groupKey for variant storage
          slug: groupKey,
        },
        autoLayoutify,
        semanticAccessiblePass,
        buildIntentGraph,
        normalizeAst,
      });

      let variantAst = single.ast;

      // If overlay is a data URL, materialize to fixtures.out and rewrite src.
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

      // Write the processed AST variant (override immediately)
      writeVariantAst(groupKey, variant, variantAst);

      // Rebuild merged preview based on stored variants
      const merged = buildMergedResponsivePreview({
        groupKey,
        autoLayoutify,
        previewHtml,
      });

      if (!merged.ok) {
        return merged;
      }

      // Write preview file for /preview/:groupKey
      const previewOut = path.join(PREVIEW_DIR, `${groupKey}.html`);
      fs.writeFileSync(previewOut, merged.preview, "utf8");

      return {
        ok: true,
        ast: merged.ast,
        fragment: merged.fragment,
        preview: merged.preview,
        // Back-compat fields expected by routes:
        phase2Report: single.phase2Report || null,
        phase2NormalizedPath: single.phase2NormalizedPath || null,
        phase3IntentPath: null,
        rasterCtaOffenders: null,
        phase3: single.phase3 || null,
        // Useful extra
        responsive: {
          groupKey,
          variantSaved: variant,
          availableVariants: merged.availableVariants,
          baseVariant: merged.baseVariant,
        },
      };
    }

    // Legacy mode (single frame export)
    const single = renderOneFragment({
      ast: astInput,
      autoLayoutify,
      semanticAccessiblePass,
      buildIntentGraph,
      normalizeAst,
    });

    // Stage for compare/autofix
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
