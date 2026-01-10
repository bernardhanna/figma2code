// generator/server/routesPreviewAndGenerate.js

import fs from "node:fs";
import path from "node:path";

import { PREVIEW_DIR } from "./runtimePaths.js";
import { getConfig } from "./configStore.js";
import { ensureThemeOutputDirs } from "./themeOutputDirs.js";
import { classStrip } from "./classSanitizer.js";
import { buildPreviewFragment, buildMergedResponsivePreview, loadVariantsForGroup } from "./fragmentPipeline.js";
import { listStages, deleteStage } from "./stageStore.js";

import { normalizeAst } from "../auto/normalizeAst.js";
import { buildIntentGraph } from "../auto/intentGraphPass.js";
import { autoLayoutify } from "../auto/autoLayoutify/index.js";
import { semanticAccessiblePass } from "../auto/phase2SemanticPass.js";
import { acfPhp } from "../templates/acf.php.js";
import { frontendPhp } from "../templates/frontend.php.js";
import { previewHtml } from "../templates/preview.html.js";

export function registerPreviewAndGenerateRoutes(app) {
  app.post("/api/preview-only", async (req, res) => {
    try {
      const r = await buildPreviewFragment({
        astInput: req.body,
        normalizeAst,
        buildIntentGraph,
        autoLayoutify,
        semanticAccessiblePass,
        previewHtml,
      });

      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });

      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);
      fs.writeFileSync(previewOut, r.preview, "utf8");

      return res.json({
        ok: true,
        previewUrl: `/preview/${r.ast.slug}`,
        phase2Report: r.phase2Report,
        phase2NormalizedPath: r.phase2NormalizedPath,
        phase3IntentPath: r.phase3IntentPath,
        rasterCtaOffenders: r.rasterCtaOffenders,
        phase3: r.phase3,
        responsive: r.responsive || null,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const astIn = req.body;
      if (!astIn?.slug && !astIn?.meta?.figma?.frameName && !astIn?.meta?.frameName) {
        return res.status(400).json({ ok: false, error: "Missing slug/frameName" });
      }
      if (!astIn?.type || !astIn?.tree) {
        return res.status(400).json({ ok: false, error: "Missing type/tree" });
      }

      const r = await buildPreviewFragment({
        astInput: astIn,
        normalizeAst,
        buildIntentGraph,
        autoLayoutify,
        semanticAccessiblePass,
        previewHtml,
      });

      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });

      const cfg = getConfig();

      const { OUT_ACF, OUT_FLEXI, OUT_NAVBAR, OUT_FOOTER } = ensureThemeOutputDirs(cfg.themeRoot);
      const phpDir = r.ast.type === "navbar" ? OUT_NAVBAR : r.ast.type === "footer" ? OUT_FOOTER : OUT_FLEXI;

      const acf = acfPhp(r.ast);
      const front = classStrip(frontendPhp(r.ast, { fragment: r.fragment }));

      const acfOut = path.join(OUT_ACF, `acf_${r.ast.slug}.php`);
      const frontOut = path.join(phpDir, `${r.ast.slug}.php`);
      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);

      fs.writeFileSync(acfOut, acf, "utf8");
      fs.writeFileSync(frontOut, front, "utf8");
      fs.writeFileSync(previewOut, r.preview, "utf8");

      return res.json({
        ok: true,
        paths: { acf: acfOut, frontend: frontOut, preview: previewOut },
        previewUrl: `/preview/${r.ast.slug}`,
        phase2Report: r.phase2Report,
        phase2NormalizedPath: r.phase2NormalizedPath,
        phase3IntentPath: r.phase3IntentPath,
        rasterCtaOffenders: r.rasterCtaOffenders,
        phase3: r.phase3,
        responsive: r.responsive || null,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Serve previews (with on-demand rebuild from variants)
  app.get("/preview/:slug", (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      const file = path.join(PREVIEW_DIR, `${slug}.html`);

      // Serve cached preview if present
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(fs.readFileSync(file, "utf8"));
      }

      // If preview missing, try to build from stored variants
      const { available } = loadVariantsForGroup(slug);
      if (available && available.length) {
        const built = buildMergedResponsivePreview({
          groupKey: slug,
          autoLayoutify,
          previewHtml,
        });

        if (built.ok) {
          fs.writeFileSync(file, built.preview, "utf8");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.send(built.preview);
        }
      }

      return res.status(404).send("Not found");
    } catch (e) {
      return res.status(500).send(String(e?.message || e));
    } 
  });

  app.get("/api/staging", (req, res) => {
    const items = listStages().map(({ slug, when }) => ({ slug, when }));
    res.json({ ok: true, items });
  });

  app.delete("/api/staging/:slug", (req, res) => {
    const ok = deleteStage(req.params.slug);
    if (!ok) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true });
  });
}
