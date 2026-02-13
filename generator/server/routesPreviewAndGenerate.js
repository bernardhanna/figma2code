// generator/server/routesPreviewAndGenerate.js

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { PREVIEW_DIR, ROOT } from "./runtimePaths.js";
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
import { applyContracts } from "../contracts/index.js";

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

function buildPreviewReport({ preflight, validation, phase2Report, phase3, contractsReport }) {
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
      contracts: contractsReport || null,
    },
  };
}

function buildContractsSummary(contractsReport) {
  if (!contractsReport) return null;
  const contracts = Array.isArray(contractsReport.contracts)
    ? contractsReport.contracts.map((entry) => ({
        name: entry.name,
        changedNodes: Number(entry.changedNodes || 0),
        notesCount: Array.isArray(entry.notes) ? entry.notes.length : 0,
      }))
    : [];
  const totals = contractsReport.totals || { changedNodes: 0, notes: 0 };
  return {
    totals: {
      changedNodes: Number(totals.changedNodes || 0),
      notes: Number(totals.notes || 0),
    },
    contracts,
  };
}

const PIPELINE_FIXTURES_DIR = path.resolve(ROOT, "..", "fixtures.out");
const PIPELINE_ROOT = path.resolve(ROOT, "..");
const ALLOWED_STAGES = new Set(["generate", "codeit", "improve"]);

function resolveStageParam(req) {
  const raw = String(req?.query?.stage || "").trim().toLowerCase();
  if (!raw) return "generate";
  return ALLOWED_STAGES.has(raw) ? raw : "generate";
}

function artifactPath(slug, stage) {
  return path.join(PIPELINE_FIXTURES_DIR, slug, `artifact.${stage}.json`);
}

function readArtifact(slug, stage) {
  if (!stage) return null;
  const file = artifactPath(slug, stage);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function resolvePipelineStageToRun(slug, stage) {
  if (stage === "generate") return "generate";
  if (stage === "codeit") {
    const inputPath = artifactPath(slug, "generate");
    return fs.existsSync(inputPath) ? "codeit" : "all";
  }
  if (stage === "improve") {
    const inputPath = artifactPath(slug, "codeit");
    return fs.existsSync(inputPath) ? "improve" : "all";
  }
  return stage;
}

function maybeBuildArtifact(slug, stage) {
  const stageToRun = stage === "generate" ? "generate" : "all";
  try {
    execFileSync(
      process.execPath,
      ["pipeline/orchestrator/cli.js", "--slug", slug, "--stage", stageToRun],
      { cwd: PIPELINE_ROOT, stdio: "pipe" }
    );
    return { ok: true };
  } catch (error) {
    const stderr = String(error?.stderr || "");
    const stdout = String(error?.stdout || "");
    return { ok: false, error: stderr || stdout || error?.message || "Pipeline failed." };
  }
}

function userPatchesPath(slug) {
  return path.join(PIPELINE_FIXTURES_DIR, slug, "patches.user.json");
}

function sanitizeUserPatchPayload(payload) {
  const safeAria = new Set(["aria-label", "aria-labelledby", "aria-describedby", "aria-hidden"]);
  const out = {
    slug: String(payload?.slug || "").trim(),
    stage: String(payload?.stage || "").trim().toLowerCase(),
    updatedAt: new Date().toISOString(),
    patches: [],
    ledger: Array.isArray(payload?.ledger) ? payload.ledger : [],
  };

  const patches = Array.isArray(payload?.patches) ? payload.patches : [];
  out.patches = patches
    .map((patch) => {
      const nodeId = String(patch?.nodeId || "").trim();
      if (!nodeId) return null;

      const ops = patch?.ops && typeof patch.ops === "object" ? patch.ops : {};
      const classAdd = Array.isArray(ops.classAdd) ? ops.classAdd.map((v) => String(v || "").trim()).filter(Boolean) : [];
      const classRemove = Array.isArray(ops.classRemove)
        ? ops.classRemove.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      const classReplace = ops.classReplace && typeof ops.classReplace === "object" ? ops.classReplace : {};

      const attrAdd = {};
      if (ops.attrAdd && typeof ops.attrAdd === "object") {
        for (const key of Object.keys(ops.attrAdd)) {
          if (!safeAria.has(String(key).toLowerCase())) continue;
          attrAdd[key] = String(ops.attrAdd[key] || "").trim();
        }
      }

      const attrRemove = Array.isArray(ops.attrRemove)
        ? ops.attrRemove.map((v) => String(v || "").trim()).filter((v) => safeAria.has(v.toLowerCase()))
        : [];

      const patchOut = {
        nodeId,
        selector: String(patch?.selector || "").trim(),
        stage: ALLOWED_STAGES.has(String(patch?.stage || "").toLowerCase())
          ? String(patch.stage).toLowerCase()
          : "",
        ops: {
          classAdd,
          classRemove,
          classReplace,
          attrAdd,
          attrRemove,
        },
      };

      return patchOut;
    })
    .filter(Boolean);

  return out;
}

export function registerPreviewAndGenerateRoutes(app, { port } = {}) {
  app.post("/api/preview-only", async (req, res) => {
    console.log("[preview-only] request received");
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
      const contractsOut = applyContracts({ html: preflight.html, slug: r.ast.slug });
      const previewFragment = contractsOut.html;
      const validation = validateTailwindClasses(previewFragment);
      const previewMarkup = previewHtml(r.ast, { fragment: previewFragment });

      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);
      fs.writeFileSync(previewOut, previewMarkup, "utf8");

      const { viewports, minHeight } = resolvePreviewViewports(r.ast);
      let screenshotUrls = {};
      try {
        screenshotUrls = await capturePreviewScreenshots({
          slug: r.ast.slug,
          port,
          viewports,
          minHeight,
        });
      } catch (screenshotErr) {
        console.warn("[preview-only] Screenshot capture failed (browser may be unavailable):", screenshotErr?.message || screenshotErr);
      }
      const screenshotUrl = screenshotUrls?.desktop || null;

      const report = buildPreviewReport({
        preflight,
        validation,
        phase2Report: r.phase2Report,
        phase3: r.phase3,
        contractsReport: contractsOut.report,
      });
      const contractsSummary = buildContractsSummary(contractsOut.report);

      console.log("[preview-only] sending response, slug:", r.ast.slug);
      return res.json(
        buildPreviewResponse({
          previewUrl: `/preview/${r.ast.slug}`,
          screenshotUrl,
          screenshotUrls,
          report,
          contractsSummary,
          paths: { preview: previewOut },
          result: r,
        })
      );
    } catch (e) {
      console.error("[preview-only] error:", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/pipeline/run", async (req, res) => {
    const slug = String(req?.body?.slug || "").trim();
    const stage = String(req?.body?.stage || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    if (!ALLOWED_STAGES.has(stage)) {
      return res.status(400).json({ ok: false, error: "Invalid stage" });
    }

    const stageToRun = resolvePipelineStageToRun(slug, stage);

    try {
      const stdout = execFileSync(
        process.execPath,
        ["pipeline/orchestrator/cli.js", "--slug", slug, "--stage", stageToRun],
        { cwd: PIPELINE_ROOT, stdio: "pipe" }
      );

      return res.json({
        ok: true,
        stage,
        stageRun: stageToRun,
        log: String(stdout || ""),
        previewUrl: `/preview/${encodeURIComponent(slug)}?stage=${encodeURIComponent(stage)}`,
      });
    } catch (error) {
      const stdout = String(error?.stdout || "");
      const stderr = String(error?.stderr || "");
      return res.status(500).json({
        ok: false,
        stage,
        stageRun: stageToRun,
        log: stdout + stderr,
        error: stderr || stdout || error?.message || "Pipeline failed.",
      });
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
      const contractsOut = applyContracts({ html: preflight.html, slug: r.ast.slug });
      const previewFragment = contractsOut.html;
      const validation = validateTailwindClasses(previewFragment);
      const previewMarkup = previewHtml(r.ast, { fragment: previewFragment });

      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);

      fs.writeFileSync(acfOut, acf, "utf8");
      fs.writeFileSync(frontOut, front, "utf8");
      fs.writeFileSync(previewOut, previewMarkup, "utf8");

      const { viewports, minHeight } = resolvePreviewViewports(r.ast);
      let screenshotUrls = {};
      try {
        screenshotUrls = await capturePreviewScreenshots({
          slug: r.ast.slug,
          port,
          viewports,
          minHeight,
        });
      } catch (screenshotErr) {
        console.warn("[preview/generate] Screenshot capture failed (browser may be unavailable):", screenshotErr?.message || screenshotErr);
      }
      const screenshotUrl = screenshotUrls?.desktop || null;

      const report = buildPreviewReport({
        preflight,
        validation,
        phase2Report: r.phase2Report,
        phase3: r.phase3,
        contractsReport: contractsOut.report,
      });
      const contractsSummary = buildContractsSummary(contractsOut.report);

      return res.json(
        buildPreviewResponse({
          previewUrl: `/preview/${r.ast.slug}`,
          screenshotUrl,
          screenshotUrls,
          report,
          contractsSummary,
          paths: { acf: acfOut, frontend: frontOut, preview: previewOut },
          result: r,
        })
      );
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Serve previews (with stage-aware artifacts or on-demand rebuild)
  app.get("/preview/:slug", (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      const file = path.join(PREVIEW_DIR, `${slug}.html`);
      const stageParam = resolveStageParam(req);

      if (stageParam) {
        let artifact = readArtifact(slug, stageParam);
        if (!artifact) {
          const build = maybeBuildArtifact(slug, stageParam);
          if (build.ok) {
            artifact = readArtifact(slug, stageParam);
          } else {
            return res
              .status(500)
              .send(
                `<pre>Failed to build artifact for stage "${stageParam}".\n${build.error}</pre>`
              );
          }
        }
        if (artifact?.html) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.send(String(artifact.html || ""));
        }

        return res
          .status(404)
          .send(
            `<pre>Missing artifact: fixtures.out/${slug}/artifact.${stageParam}.json\nRun: node pipeline/orchestrator/cli.js --slug ${slug} --stage ${stageParam}</pre>`
          );
      }

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

  app.get("/api/patches/:slug", (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    const file = userPatchesPath(slug);
    if (!fs.existsSync(file)) return res.status(404).json({ ok: false, error: "Not found" });
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      return res.json({ ok: true, data: json });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/patches/:slug", (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    try {
      const outDir = path.join(PIPELINE_FIXTURES_DIR, slug);
      fs.mkdirSync(outDir, { recursive: true });
      const payload = sanitizeUserPatchPayload({ ...req.body, slug });
      const file = userPatchesPath(slug);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
      return res.json({ ok: true, path: file });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
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
