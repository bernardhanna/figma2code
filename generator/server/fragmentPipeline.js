// generator/server/fragmentPipeline.js

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { PREVIEW_DIR } from "./runtimePaths.js";
import { decideResponsiveStrategy } from "./variantDecision.js";
import { mergeResponsiveFragments } from "../auto/mergeResponsiveFragments.js";

import { parseGroupVariant } from "./variantNaming.js";
import {
  writeVariantAst,
  readVariantAstIfExists,
  materializeOverlayIfPossible,
} from "./variantStore.js";

import { writeStage } from "./stageStore.js";

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function slugifyGroupKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
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

  if (asObj(out) && asObj(out.ast) && asObj(out.ast.tree)) return { ast: out.ast, extra: out };
  if (asObj(out) && asObj(out.tree)) return { ast: out, extra: null };

  return { ast: fallbackAst, extra: null };
}

/**
 * IMPORTANT: Prefer desktop as base so preview defaults to desktop-correct markup
 * when you are in desktop mode.
 */
function pickBaseVariant(variantsMap) {
  if (variantsMap.desktop) return "desktop";
  if (variantsMap.tablet) return "tablet";
  if (variantsMap.mobile) return "mobile";
  return "";
}

/**
 * Build the "merged AST" (metadata carrier) used by previewHtml shell.
 * Fonts and responsive meta are merged across variants.
 */
function compositeAstForMerged({ groupKey, variantsMap }) {
  const baseKey = pickBaseVariant(variantsMap);
  const baseAst = variantsMap[baseKey] || null;
  if (!baseAst) return null;

  // Merge fonts across variants (best-effort union)
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

  // Stamp widths if present on each variant AST frame
  const widths = {
    mobile: Number(variantsMap?.mobile?.frame?.w || variantsMap?.mobile?.tree?.w || 0) || 0,
    tablet: Number(variantsMap?.tablet?.frame?.w || variantsMap?.tablet?.tree?.w || 0) || 0,
    desktop: Number(variantsMap?.desktop?.frame?.w || variantsMap?.desktop?.tree?.w || 0) || 0,
  };

  return {
    ...baseAst,
    slug: groupKey,
    meta: {
      ...(baseAst.meta || {}),
      fonts: fonts.length ? fonts : baseAst.meta?.fonts || [],
      responsive: {
        groupKey,
        variants: ["mobile", "tablet", "desktop"].filter((k) => !!variantsMap[k]),
        base: baseKey,
        mdFrom: variantsMap.tablet ? "tablet" : "",
        lgFrom: variantsMap.desktop ? "desktop" : "",
        widths: {
          mobile: widths.mobile || 390,
          tablet: widths.tablet || 1084,
          desktop: widths.desktop || (baseAst?.frame?.w || baseAst?.tree?.w || 1200),
        },
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
export function renderOneFragment({
  ast,
  autoLayoutify,
  semanticAccessiblePass,
  preventNestedInteractive,
  buildIntentGraph,
  normalizeAst,
}) {
  let a = ast;

  if (normalizeAst) {
    const r = normalizeAst(a);
    const un = unwrapAstResult(r, a);
    a = un.ast || a;
  }

  let phase3 = null;
  if (buildIntentGraph) {
    const r = buildIntentGraph(a);
    const un = unwrapAstResult(r, a);
    a = un.ast;
    phase3 = un.extra || null;
  }

  if (preventNestedInteractive) {
    const r = preventNestedInteractive(a);
    const un = unwrapAstResult(r, a);
    a = un.ast || a;
  }

  if (!a || !a.tree) {
    throw new Error("renderOneFragment: pipeline produced AST missing tree");
  }

  const semantics = a?.semantics || a?.semanticsMap || a?.meta?.semantics || {};
  let fragment = autoLayoutify(a, {
    semantics,
    wrap: true,
    fontMap: a?.meta?.fontMap || {},
  });

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

  function renderVariant(ast, label) {
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
      phase2Reports[label] = out?.report || null;
    }

    return html;
  }

  const mobileHtml = renderVariant(mobileAst, "mobile");
  const tabletHtml = renderVariant(tabletAst, "tablet");
  const desktopHtml = renderVariant(desktopAst, "desktop");

  console.log("[variants] lens", {
    mobile: mobileHtml?.length || 0,
    tablet: tabletHtml?.length || 0,
    desktop: desktopHtml?.length || 0,
  });

  // ------------------------------------------------------------
  // FORCE MERGE (your stated requirement)
  // ------------------------------------------------------------
  const mergedFragment = mergeResponsiveFragments({
    desktopHtml,
    tabletHtml,
    mobileHtml,
      mobilePrefix: "max-md",
  tabletPrefix: "max-lg",
    mode: "viewport",
    baseVariant: "desktop",
    breakpoints: { mobileMax: 768, tabletMax: 1084 },
  });

  // Build merged AST (metadata carrier)
  const mergedAst = compositeAstForMerged({ groupKey, variantsMap });
  if (!mergedAst?.tree) {
    return { ok: false, status: 500, error: `Failed to build merged AST for "${groupKey}".` };
  }

  // ------------------------------------------------------------
  // Persist per-variant overlay/bg so preview can swap them correctly
  // ------------------------------------------------------------
  const overlay = {
    mobile: String(mobileAst?.meta?.overlay?.src || "").trim(),
    tablet: String(tabletAst?.meta?.overlay?.src || "").trim(),
    desktop: String(desktopAst?.meta?.overlay?.src || "").trim(),
  };

  const bg = {
    mobile: String(mobileAst?.meta?.bg?.src || mobileAst?.meta?.background?.src || "").trim(),
    tablet: String(tabletAst?.meta?.bg?.src || tabletAst?.meta?.background?.src || "").trim(),
    desktop: String(desktopAst?.meta?.bg?.src || desktopAst?.meta?.background?.src || "").trim(),
  };

  mergedAst.meta = {
    ...(mergedAst.meta || {}),
    responsive: {
      ...(mergedAst.meta?.responsive || {}),
      mergedGroup: true,
      assets: { overlay, bg },
    },
  };

  writeStage(groupKey, mergedAst);

  // IMPORTANT: previewHtml must now render inside an iframe for Tailwind breakpoints
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
      String(astInput?.meta?.figma?.frameName || "").trim() ||
      String(astInput?.tree?.name || "").trim() ||
      String(astInput?.frame?.name || "").trim() ||
      String(astInput?.slug || "").trim();

    const parsed = parseGroupVariant(nameSource);
    console.log("[variant]", { nameSource, parsed });

    ensurePreviewDir();

    // ---------------- Variant mode ----------------
    if (parsed.isVariant) {
      const groupKey = slugifyGroupKey(parsed.groupKey);
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

      // Materialize overlay into fixtures.out/<group>/figma.<variant>.png
      const overlaySrc = String(variantAst?.meta?.overlay?.src || "").trim();
      if (overlaySrc) {
        const serverUrl = process.env.PREVIEW_BASE_URL || `http://127.0.0.1:5173`;

        const newSrc = await materializeOverlayIfPossible({
          groupKey,
          variant,
          overlaySrc,
          serverUrl,
        });

        if (newSrc && newSrc !== overlaySrc) {
          variantAst = {
            ...variantAst,
            meta: {
              ...(variantAst.meta || {}),
              overlay: { ...(variantAst.meta?.overlay || {}), src: newSrc },
            },
          };
        }
      }

      writeVariantAst(groupKey, variant, variantAst);

      const merged = buildMergedResponsivePreview({
        groupKey,
        autoLayoutify,
        semanticAccessiblePass,
        previewHtml,
      });

      if (!merged.ok) return merged;

      const previewOut = path.join(PREVIEW_DIR, `${groupKey}.html`);
      fs.writeFileSync(previewOut, merged.preview, "utf8");

      return {
        ok: true,
        ast: merged.ast,
        fragment: merged.fragment,
        preview: merged.preview,

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
