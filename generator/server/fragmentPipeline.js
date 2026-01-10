// generator/server/fragmentPipeline.js

import { applyNamedBackgroundFallback } from "./backgroundFallback.js";
import { maybeAIRefine } from "./aiRefine.js";
import { writePhase2Normalized, writePhase3Intent, writeStage } from "./stageStore.js";
import { findRasterizedClickableInstancesWithoutText } from "./diagnosticsRasterCta.js";

/**
 * Normalize autoLayoutify return type (supports both string and { html })
 */
function getFragmentFromAutoLayoutify(result) {
  if (typeof result === "string") return result;
  if (result && typeof result.html === "string") return result.html;
  return undefined;
}

export async function buildPreviewFragment({
  astInput,
  normalizeAst,
  buildIntentGraph,
  autoLayoutify,
  semanticAccessiblePass,
  previewHtml,
}) {
  let ast = astInput;

  if (!ast?.slug || !ast?.tree) {
    return { ok: false, status: 400, error: "Missing slug/tree" };
  }

  ast = normalizeAst(ast);
  if (!ast?.tree) {
    return { ok: false, status: 400, error: "AST tree empty after normalization" };
  }

  const phase2NormalizedPath = writePhase2Normalized(ast.slug, ast);

  const intent = buildIntentGraph(ast);
  const phase3IntentPath = writePhase3Intent(ast.slug, intent);

  ast = applyNamedBackgroundFallback(ast);

  const semantics = ast.semantics || {};

  const raw = autoLayoutify(ast, { semantics, wrap: true });
  let fragment = getFragmentFromAutoLayoutify(raw);

  if (!fragment) {
    return { ok: false, status: 500, error: "autoLayoutify returned no HTML fragment" };
  }

  const phase2 = semanticAccessiblePass({ html: fragment, ast, semantics });
  fragment = phase2.html;

  fragment = await maybeAIRefine(fragment, ast);

  // Diagnostics: rasterized clickable instances with no text payload
  const rasterCtaOffenders = findRasterizedClickableInstancesWithoutText(ast);
  if (rasterCtaOffenders.length) {
    phase2.report = phase2.report || { fixes: [], warnings: [] };
    phase2.report.warnings = Array.isArray(phase2.report.warnings) ? phase2.report.warnings : [];
    phase2.report.warnings.push(
      `CTA text missing: ${rasterCtaOffenders.length} clickable INSTANCE node(s) are rasterized (img.src) without any text payload. ` +
      `Fix in Figma export: attach __instanceText or keep TEXT children. Example nodeId(s): ` +
      rasterCtaOffenders
        .slice(0, 6)
        .map((x) => x.id)
        .join(", ") +
      (rasterCtaOffenders.length > 6 ? "…" : "")
    );
  }

  const preview = previewHtml(ast, { fragment });

  // Persist stage (fragment + reports)
  writeStage(ast.slug, ast, fragment, {
    phase2Report: phase2.report,
    rasterCtaOffenders,
  });

  return {
    ok: true,
    ast,
    fragment,
    preview,
    phase2Report: phase2.report,
    rasterCtaOffenders,
    phase2NormalizedPath,
    phase3IntentPath,
    phase3: {
      sectionType: intent.sectionType,
      collections: Array.isArray(intent.collections) ? intent.collections.length : 0,
      warnings: Array.isArray(intent.warnings) ? intent.warnings.length : 0,
    },
  };
}
