// generator/server/routesPreviewAndGenerate.js

import fs from "node:fs";
import path from "node:path";

import { PREVIEW_DIR } from "./runtimePaths.js";
import { getConfig } from "./configStore.js";
import { ensureThemeOutputDirs } from "./themeOutputDirs.js";
import { classStrip } from "./classSanitizer.js";
import { repairTailwindClasses, validateTailwindClasses } from "./tailwindPreflight.js";
import { capturePreviewScreenshot, capturePreviewScreenshots } from "./previewScreenshot.js";
import { buildPreviewResponse } from "./previewResponse.js";
import {
  buildPreviewFragment,
  buildMergedResponsivePreview,
  loadVariantsForGroup,
} from "./fragmentPipeline.js";
import { listStages, deleteStage } from "./stageStore.js";

import { normalizeAst } from "../auto/normalizeAst.js";
import { buildIntentGraph } from "../auto/intentGraphPass.js";
import { autoLayoutify } from "../auto/autoLayoutify/index.js";
import { semanticAccessiblePass } from "../auto/phase2SemanticPass.js";
import { interactiveStatesPass } from "../auto/interactiveStatesPass.js";
import { acfPhp } from "../templates/acf.php.js";
import { frontendPhp } from "../templates/frontend.php.js";
import { preventNestedInteractive } from "../auto/preventNestedInteractive.js";
import { previewHtml } from "../templates/preview.html.js";

function resolvePreviewViewport(ast) {
  const widthRaw =
    Number(ast?.meta?.responsive?.widths?.desktop) ||
    Number(ast?.frame?.w) ||
    Number(ast?.tree?.w) ||
    1440;
  const heightRaw = Number(ast?.frame?.h) || Number(ast?.tree?.h) || 900;

  const width = Math.max(320, Math.round(widthRaw || 1440));
  const height = Math.max(900, Math.round((heightRaw || 900) + 140));
  const minHeight = Math.max(200, Math.round(heightRaw || 200));

  return { viewport: { width, height }, minHeight };
}

function resolvePreviewViewports(ast) {
  const base = resolvePreviewViewport(ast);
  const widths = {
    mobile: Number(ast?.meta?.responsive?.widths?.mobile) || 390,
    tablet: Number(ast?.meta?.responsive?.widths?.tablet) || 1084,
    desktop: Number(ast?.meta?.responsive?.widths?.desktop) || base.viewport.width || 1440,
  };

  const height = base.viewport.height || 900;

  return {
    minHeight: base.minHeight,
    viewports: [
      { key: "desktop", viewport: { width: Math.max(320, Math.round(widths.desktop)), height } },
      { key: "tablet", viewport: { width: Math.max(320, Math.round(widths.tablet)), height } },
      { key: "mobile", viewport: { width: Math.max(320, Math.round(widths.mobile)), height } },
    ],
  };
}

function buildPreviewReport({ preflight, validation, phase2Report, phase3 }) {
  const warnings = [];
  const errors = [];
  const fixes = [];

  if (preflight?.report?.fixes?.length) fixes.push(...preflight.report.fixes);

  if (phase2Report?.fixes?.length) {
    fixes.push(...phase2Report.fixes.map((f) => `semantic: ${f}`));
  }

  if (validation?.warnings?.length) warnings.push(...validation.warnings);

  if (phase2Report?.warnings?.length) {
    warnings.push(...phase2Report.warnings.map((w) => `semantic: ${w}`));
  }

  if (Array.isArray(phase3?.warnings) && phase3.warnings.length) {
    warnings.push(
      ...phase3.warnings.map((w) =>
        typeof w === "string" ? `intent: ${w}` : `intent: ${w?.message || JSON.stringify(w)}`
      )
    );
  }

  return {
    warnings,
    errors,
    fixes,
    summary: { warnings: warnings.length, errors: errors.length, fixes: fixes.length },
    details: {
      tailwindPreflight: preflight?.report || null,
      tailwindValidation: validation || null,
      semantic: phase2Report || null,
      intentWarnings: phase3?.warnings || null,
    },
  };
}

export function registerPreviewAndGenerateRoutes(app, { port } = {}) {
  app.post("/api/preview-only", async (req, res) => {
    try {
      const r = await buildPreviewFragment({
        astInput: req.body,
        normalizeAst,
        buildIntentGraph,
        autoLayoutify,
        semanticAccessiblePass,
        preventNestedInteractive,
        interactiveStatesPass,
        previewHtml,
        previewOnly: true,
      });

      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });

      const preflight = repairTailwindClasses(r.fragment || "");
      const previewFragment = preflight.html;
      const validation = validateTailwindClasses(previewFragment);
      const previewMarkup = previewHtml(r.ast, { fragment: previewFragment });

      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);
      fs.writeFileSync(previewOut, previewMarkup, "utf8");

      const { viewports, minHeight } = resolvePreviewViewports(r.ast);
      const screenshotUrls = await capturePreviewScreenshots({
        slug: r.ast.slug,
        port,
        viewports,
        minHeight,
      });
      const screenshotUrl = screenshotUrls?.desktop || null;

      const report = buildPreviewReport({
        preflight,
        validation,
        phase2Report: r.phase2Report,
        phase3: r.phase3,
      });

      return res.json(
        buildPreviewResponse({
          previewUrl: `/preview/${r.ast.slug}`,
          screenshotUrl,
          screenshotUrls,
          report,
          paths: { preview: previewOut },
          result: r,
        })
      );
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
        preventNestedInteractive,
        interactiveStatesPass,
        previewHtml,
        previewOnly: false,
      });

      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });

      const cfg = getConfig();

      const { OUT_ACF, OUT_FLEXI, OUT_NAVBAR, OUT_FOOTER } = ensureThemeOutputDirs(cfg.themeRoot);
      const phpDir = r.ast.type === "navbar" ? OUT_NAVBAR : r.ast.type === "footer" ? OUT_FOOTER : OUT_FLEXI;

      const acf = acfPhp(r.ast);
      const front = classStrip(frontendPhp(r.ast, { fragment: r.fragment }));

      const acfOut = path.join(OUT_ACF, `acf_${r.ast.slug}.php`);
      const frontOut = path.join(phpDir, `${r.ast.slug}.php`);
      const preflight = repairTailwindClasses(r.fragment || "");
      const previewFragment = preflight.html;
      const validation = validateTailwindClasses(previewFragment);
      const previewMarkup = previewHtml(r.ast, { fragment: previewFragment });

      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);

      fs.writeFileSync(acfOut, acf, "utf8");
      fs.writeFileSync(frontOut, front, "utf8");
      fs.writeFileSync(previewOut, previewMarkup, "utf8");

      const { viewports, minHeight } = resolvePreviewViewports(r.ast);
      const screenshotUrls = await capturePreviewScreenshots({
        slug: r.ast.slug,
        port,
        viewports,
        minHeight,
      });
      const screenshotUrl = screenshotUrls?.desktop || null;

      const report = buildPreviewReport({
        preflight,
        validation,
        phase2Report: r.phase2Report,
        phase3: r.phase3,
      });

      return res.json(
        buildPreviewResponse({
          previewUrl: `/preview/${r.ast.slug}`,
          screenshotUrl,
          screenshotUrls,
          report,
          paths: { acf: acfOut, frontend: frontOut, preview: previewOut },
          result: r,
        })
      );
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
          semanticAccessiblePass, // IMPORTANT
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
