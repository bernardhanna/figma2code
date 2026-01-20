// generator/server/routesBatchUpload.js
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { PREVIEW_DIR } from "./runtimePaths.js";
import { isValidVariant, parseGroupVariant } from "./variantNaming.js";
import { writeVariantAst, materializeOverlayIfPossible } from "./variantStore.js";
import { buildMergedResponsivePreview } from "./fragmentPipeline.js";

function slugifyGroupKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function registerBatchUploadRoutes(app, deps) {
  const {
    normalizeAst,
    buildIntentGraph,
    autoLayoutify,
    semanticAccessiblePass,
    preventNestedInteractive,
    previewHtml,
    renderOneFragment,
  } = deps || {};

  if (!renderOneFragment || !autoLayoutify || !previewHtml) {
    throw new Error(
      "registerBatchUploadRoutes: missing deps (need at least renderOneFragment, autoLayoutify, previewHtml)"
    );
  }

  app.post("/api/upload-batch", async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ ok: false, error: "Missing items[]" });

      // Determine groupKey (prefer explicit)
      let groupKey = String(req.body?.groupKey || "").trim();

      if (!groupKey) {
        // Derive from first item's ast frame name
        const firstAst = items[0]?.ast;
        const nameSource =
          String(firstAst?.slug || "").trim() ||
          String(firstAst?.meta?.figma?.frameName || "").trim() ||
          String(firstAst?.meta?.frameName || "").trim();

        const parsed = parseGroupVariant(nameSource);
        groupKey = parsed.groupKey || nameSource;
      }

      groupKey = slugifyGroupKey(groupKey);
      if (!groupKey) return res.status(400).json({ ok: false, error: "Invalid groupKey" });

      // For relative overlay fetch ("/assets/..")
      const serverUrl = process.env.PREVIEW_BASE_URL || `http://127.0.0.1:5173`;

      // Save each variant
      for (const item of items) {
        const variant = String(item?.variant || "").toLowerCase().trim();
        const astInput = item?.ast;

        if (!isValidVariant(variant)) {
          return res.status(400).json({ ok: false, error: `Invalid variant "${variant}"` });
        }
        if (!astInput?.tree) {
          return res.status(400).json({ ok: false, error: `Missing tree for "${variant}"` });
        }

        const single = renderOneFragment({
          ast: { ...astInput, slug: groupKey },
          autoLayoutify,
          semanticAccessiblePass,
          preventNestedInteractive,
          buildIntentGraph,
          normalizeAst,
          viewport: variant,
        });

        let variantAst = single.ast;

        // Materialize overlay to fixtures.out/<groupKey>/figma.<variant>.png
        const overlaySrc = String(variantAst?.meta?.overlay?.src || "").trim();
        if (overlaySrc) {
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
      }

      // Merge preview from stored variants
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });

      const merged = buildMergedResponsivePreview({
        groupKey,
        autoLayoutify,
        semanticAccessiblePass,
        previewHtml,
        previewOnly: true,
      });

      if (!merged.ok) return res.status(merged.status || 500).json(merged);

      const previewOut = path.join(PREVIEW_DIR, `${groupKey}.html`);
      fs.writeFileSync(previewOut, merged.preview, "utf8");

      return res.json({
        ok: true,
        groupKey,
        availableVariants: merged.availableVariants,
        baseVariant: merged.baseVariant,
        previewUrl: `/preview/${encodeURIComponent(groupKey)}`,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
