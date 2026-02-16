// generator/server/routesPreviewAndGenerate.js

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const qaGate = require(path.join(REPO_ROOT, "pipeline", "qaGate", "index.js"));
const runQAGate = qaGate.runQAGate;
const runQAFixLoop = qaGate.runQAFixLoop;
const fixQAGate = qaGate.fix;
const auditQAGate = qaGate.audit;

import { PREVIEW_DIR, ROOT } from "./runtimePaths.js";
import { getConfig } from "./configStore.js";
import { ensureThemeOutputDirs } from "./themeOutputDirs.js";
import { classStrip } from "./classSanitizer.js";
import { capturePreviewScreenshot, capturePreviewScreenshots } from "./previewScreenshot.js";
import { buildPreviewResponse } from "./previewResponse.js";
import {
  buildPreviewFragment,
} from "./fragmentPipeline.js";
import { runBuildAndPreview } from "./buildOrchestrator.js";
import { listStages, deleteStage } from "./stageStore.js";

import { normalizeAst } from "../auto/normalizeAst.js";
import { buildIntentGraph } from "../auto/intentGraphPass.js";
import { autoLayoutify } from "../auto/autoLayoutify/index.js";
import { semanticAccessiblePass } from "../auto/phase2SemanticPass.js";
import { interactiveStatesPass } from "../auto/interactiveStatesPass.js";
import { acfPhp } from "../templates/acf.php.js";
import { frontendPhp } from "../templates/frontend.php.js";
import { preventNestedInteractive } from "../auto/preventNestedInteractive.js";
import { learnedRulesPass } from "../auto/learnedRulesPass.js";
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

function readBuildReport(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
}

function buildResponseReportFromBuildReport(buildReport, fallback = {}) {
  if (!buildReport) return fallback;
  const warnings = Array.isArray(buildReport.warnings) ? buildReport.warnings : [];
  const errors = [];
  if (buildReport.error) {
    errors.push(`${buildReport.stage || "unknown"}: ${buildReport.error}`);
  }
  const fixes = Array.isArray(buildReport.autoFixesApplied) ? buildReport.autoFixesApplied : [];
  return {
    warnings,
    errors,
    fixes,
    summary: {
      warnings: warnings.length,
      errors: errors.length,
      fixes: fixes.length,
      timings: buildReport.timings || {},
      buildStatus: buildReport.buildStatus || "unknown",
    },
    details: {
      stages: buildReport.stages || {},
      qa: buildReport.qa || null,
      contracts: buildReport.contracts || null,
      events: buildReport.events || [],
    },
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

const shortChecksum = (value) =>
  crypto.createHash("sha1").update(String(value || ""), "utf8").digest("hex").slice(0, 10);

const summarizeIssues = (issues) => ({
  error: issues.filter((i) => i.severity === "error").length,
  warn: issues.filter((i) => i.severity === "warn").length,
  info: issues.filter((i) => i.severity === "info").length,
});

const byRuleFromIssues = (issues) => {
  const out = {};
  (issues || []).forEach((i) => {
    const key = String(i?.rule || "").trim();
    if (!key) return;
    out[key] = (out[key] || 0) + 1;
  });
  return out;
};

const QA_FATAL_RULES = new Set([
  "DUPLICATE_DATA_NODE_ID",
  "DUPLICATE_DATA_KEY_ROOT",
  "MULTIPLE_TOP_LEVEL_ROOTS",
  "STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY",
  "UNBALANCED_HTML_TAGS",
]);

function validateFixedHtmlForApply(html) {
  const report = auditQAGate(String(html || ""));
  const fatalIssues = (report?.issues || []).filter((issue) => issue?.fatal || QA_FATAL_RULES.has(String(issue?.rule || "")));
  return {
    ok: fatalIssues.length === 0,
    report,
    fatalIssues,
  };
}

export function repairCachedPreviewHtml(rawHtml) {
  let html = String(rawHtml || "");
  // Repair stale previews where newline was emitted as a literal newline inside a JS string (invalid).
  // .join(" \n ") or .join("\n") with real newline → .join("\n")
  html = html.replace(/\.join\("\s*\r?\n\s*"\)/g, '.join("\\n")');
  html = html.replace(/\.join\('\s*\r?\n\s*'\)/g, ".join('\\n')");
  // .split(" \n ") with real newline → .split("\n")
  html = html.replace(/\.split\("\s*\r?\n\s*"\)/g, '.split("\\n")');
  html = html.replace(/\.split\('\s*\r?\n\s*'\)/g, ".split('\\n')");
  return html;
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
        learnedRulesPass,
        interactiveStatesPass,
        previewHtml,
        previewOnly: true,
      });

      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });

      const build = await runBuildAndPreview({ slug: r.ast.slug });
      if (!build.ok) {
        return res.status(500).json({
          ok: false,
          error: build.error || "Build pipeline failed.",
          stage: build.stage,
          reportPath: build.reportPath ?? undefined,
        });
      }
      const buildReport = readBuildReport(build.reportPath);
      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);

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

      const report = buildResponseReportFromBuildReport(buildReport, {
        warnings: [],
        errors: [],
        fixes: [],
      });
      const contractsSummary = buildContractsSummary(buildReport?.contracts || null);

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

      // Invalidate preview cache so next load rebuilds from updated artifacts
      const previewCacheFile = path.join(PREVIEW_DIR, `${slug}.html`);
      if (fs.existsSync(previewCacheFile)) {
        try {
          fs.unlinkSync(previewCacheFile);
        } catch {
          // Non-fatal: next load will still serve stale cache, but user can hard refresh
        }
      }

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

  app.post("/api/qa-gate/run", (req, res) => {
    const slug = String(req?.body?.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

    const sourceStage = readArtifact(slug, "improve")?.html != null ? "improve" : readArtifact(slug, "codeit")?.html != null ? "codeit" : null;
    if (!sourceStage) {
      return res.status(404).json({
        ok: false,
        error: "No artifact found for slug (run Improve or Code it first)",
      });
    }

    const artifact = readArtifact(slug, sourceStage);
    // QA runs in PREVIEW MODE on the exact HTML used to render the preview (finalHtml from iframe body).
    // Integrity rules (DUPLICATE_DATA_NODE_ID, DUPLICATE_DATA_KEY_ROOT) run on this string only.
    const finalHtml = typeof req?.body?.finalHtml === "string" ? req.body.finalHtml : null;
    const previewHtml = typeof req?.body?.previewHtml === "string" ? req.body.previewHtml : finalHtml;
    if (finalHtml == null) {
      return res.status(400).json({
        ok: false,
        error: "Missing finalHtml (QA must run against preview source-of-truth HTML).",
      });
    }
    const html = String(finalHtml || "");
    const previewHtmlStr = String(previewHtml || "");

    try {
      const result = runQAGate(html, {
        artifact,
        cleanMetadata: false,
      });
      const auditedLen = html.length;
      const previewLen = previewHtmlStr.length;
      const auditedHash = shortChecksum(html);
      const previewHash = shortChecksum(previewHtmlStr);
      const inputMismatch = auditedHash !== previewHash;

      if (process.env.NODE_ENV !== "production") {
        console.debug("[qa-gate] html-check", {
          slug,
          auditedLen,
          auditedHash,
          previewLen,
          previewHash,
        });
      }

      let reportBefore = result.reportBefore;
      let reportAfter = result.reportAfter;
      let blockApply = false;

      if (inputMismatch) {
        const fatal = {
          id: "qa-QA_INPUT_MISMATCH",
          severity: "error",
          rule: "QA_INPUT_MISMATCH",
          message: "QA input mismatch: audited HTML differs from preview HTML",
          selector: null,
          snippet: null,
          fatal: true,
        };
        const beforeIssues = [...(reportBefore?.issues || []), fatal];
        const afterIssues = [...(reportAfter?.issues || []), fatal];
        reportBefore = {
          ...(reportBefore || {}),
          issues: beforeIssues,
          summary: summarizeIssues(beforeIssues),
          byRule: byRuleFromIssues(beforeIssues),
        };
        reportAfter = {
          ...(reportAfter || {}),
          issues: afterIssues,
          summary: summarizeIssues(afterIssues),
          byRule: byRuleFromIssues(afterIssues),
        };
        blockApply = true;
      }

      const hasFatalAfter = (reportAfter?.issues || []).some((i) => i && i.fatal);
      if (hasFatalAfter) blockApply = true;

      return res.json({
        ok: true,
        slug,
        sourceStage,
        reportBefore,
        reportAfter,
        appliedFixes: result.appliedFixes,
        diff: result.diff,
        diffTruncated: result.diffTruncated,
        totalChanges: result.totalChanges,
        fixedHtml: result.fixedHtml,
        currentHtml: result.currentHtml,
        remainingErrors: reportAfter?.summary?.error || 0,
        remainingFatal: (reportAfter?.issues || []).filter((i) => i && i.fatal).length,
        byRule: reportAfter?.byRule || {},
        blockApply,
        qaInputMismatch: inputMismatch,
        debug: {
          auditedLen,
          auditedHash,
          previewLen,
          previewHash,
        },
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: String(e?.message || e),
      });
    }
  });

  app.post("/api/qa-gate/fix-loop", (req, res) => {
    const slug = String(req?.body?.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

    const sourceStage = readArtifact(slug, "improve")?.html != null ? "improve" : readArtifact(slug, "codeit")?.html != null ? "codeit" : null;
    if (!sourceStage) {
      return res.status(404).json({
        ok: false,
        error: "No artifact found for slug (run Improve or Code it first)",
      });
    }

    const artifact = readArtifact(slug, sourceStage);
    const finalHtml = typeof req?.body?.finalHtml === "string" ? req.body.finalHtml : null;
    const previewHtml = typeof req?.body?.previewHtml === "string" ? req.body.previewHtml : finalHtml;
    if (finalHtml == null) {
      return res.status(400).json({
        ok: false,
        error: "Missing finalHtml (QA fix loop must run against preview source-of-truth HTML).",
      });
    }
    const html = String(finalHtml || "");
    const previewHtmlStr = String(previewHtml || "");
    const maxIterations = Math.max(1, Math.min(50, Number(req?.body?.maxIterations || 10)));
    const maxFixesPerIteration = Math.max(1, Math.min(500, Number(req?.body?.maxFixesPerIteration || 200)));

    try {
      const result = runQAFixLoop(html, {
        artifact,
        maxIterations,
        maxFixesPerIteration,
      });
      const auditedLen = html.length;
      const previewLen = previewHtmlStr.length;
      const auditedHash = shortChecksum(html);
      const previewHash = shortChecksum(previewHtmlStr);
      const inputMismatch = auditedHash !== previewHash;
      const hasFatalAfter = (result.reportAfter?.issues || []).some((i) => i && i.fatal);
      const blockApply = inputMismatch || hasFatalAfter;

      return res.json({
        ok: true,
        slug,
        sourceStage,
        ...result,
        blockApply,
        qaInputMismatch: inputMismatch,
        debug: {
          auditedLen,
          auditedHash,
          previewLen,
          previewHash,
        },
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: String(e?.message || e),
      });
    }
  });

  app.post("/api/qa-gate/apply", (req, res) => {
    const slug = String(req?.body?.slug || "").trim();
    const fixedHtml = req?.body?.fixedHtml;
    const sourceStage = String(req?.body?.sourceStage || "improve").trim().toLowerCase();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    if (typeof fixedHtml !== "string") return res.status(400).json({ ok: false, error: "Missing fixedHtml" });
    if (!ALLOWED_STAGES.has(sourceStage)) return res.status(400).json({ ok: false, error: "Invalid sourceStage" });

    const file = artifactPath(slug, sourceStage);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ ok: false, error: "Artifact not found" });
    }

    try {
      const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
      const validation = validateFixedHtmlForApply(fixedHtml);
      if (!validation.ok) {
        return res.status(400).json({
          ok: false,
          error: "Refusing to apply structurally invalid QA output.",
          fatalIssues: validation.fatalIssues,
          reportAfter: validation.report,
        });
      }
      artifact.html = fixedHtml;
      fs.writeFileSync(file, JSON.stringify(artifact, null, 2), "utf8");

      // Invalidate preview cache so next load rebuilds from updated artifact
      const previewCacheFile = path.join(PREVIEW_DIR, `${slug}.html`);
      if (fs.existsSync(previewCacheFile)) {
        try {
          fs.unlinkSync(previewCacheFile);
        } catch {
          // Non-fatal: next load will still serve stale cache, but user can hard refresh
        }
      }

      return res.json({
        ok: true,
        slug,
        sourceStage,
        previewUrl: `/preview/${encodeURIComponent(slug)}?stage=${encodeURIComponent(sourceStage)}`,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/qa-gate/clean-fragment", (req, res) => {
    const slug = String(req?.body?.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

    const sourceStage = readArtifact(slug, "improve")?.html != null ? "improve" : readArtifact(slug, "codeit")?.html != null ? "codeit" : null;
    if (!sourceStage) {
      return res.status(404).json({
        ok: false,
        error: "No artifact found for slug (run Improve or Code it first)",
      });
    }

    const finalHtml = typeof req?.body?.finalHtml === "string" ? req.body.finalHtml : null;
    const artifact = readArtifact(slug, sourceStage);
    const baseHtml = String(artifact?.html || finalHtml || "");
    if (!baseHtml) {
      return res.status(400).json({
        ok: false,
        error: "Missing fragment HTML source.",
      });
    }

    try {
      const cleaned = fixQAGate(baseHtml, [], { cleanMetadata: true });
      const validation = validateFixedHtmlForApply(cleaned.fixedHtml);
      if (!validation.ok) {
        return res.status(400).json({
          ok: false,
          error: "Clean fragment failed structural validation.",
          fatalIssues: validation.fatalIssues,
          reportAfter: validation.report,
        });
      }
      return res.json({
        ok: true,
        slug,
        sourceStage,
        cleanedHtml: cleaned.fixedHtml,
        appliedFixes: cleaned.appliedFixes || [],
      });
    } catch (e) {
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
        learnedRulesPass,
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
      const previewOut = path.join(PREVIEW_DIR, `${r.ast.slug}.html`);

      fs.writeFileSync(acfOut, acf, "utf8");
      fs.writeFileSync(frontOut, front, "utf8");
      const build = await runBuildAndPreview({ slug: r.ast.slug });
      if (!build.ok) {
        return res.status(500).json({
          ok: false,
          error: build.error || "Build pipeline failed.",
          stage: build.stage,
          reportPath: build.reportPath ?? undefined,
          paths: { acf: acfOut, frontend: frontOut },
        });
      }
      const buildReport = readBuildReport(build.reportPath);

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

      const report = buildResponseReportFromBuildReport(buildReport, {
        warnings: [],
        errors: [],
        fixes: [],
      });
      const contractsSummary = buildContractsSummary(buildReport?.contracts || null);

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

  // One-click Build & Open Preview: run full pipeline then redirect to preview
  app.post("/api/build-preview", async (req, res) => {
    const slug =
      String(req?.body?.slug ?? req?.query?.slug ?? "").trim() ||
      String(req?.body?.slug ?? "").trim();
    if (!slug) {
      return res.status(400).json({ ok: false, error: "Missing slug", stage: "inputs" });
    }
    try {
      const result = await runBuildAndPreview({ slug });
      if (result.ok) {
        const prefersJson =
          /application\/json/i.test(String(req.get("accept") || "")) ||
          req.get("accept") === "*/*";
        if (prefersJson) {
          return res.json({
            ok: true,
            slug: result.slug,
            reportPath: result.reportPath,
            previewUrl: `/preview/${encodeURIComponent(result.slug)}`,
          });
        }
        return res.redirect(302, `/preview/${encodeURIComponent(result.slug)}`);
      }
      return res.status(500).json({
        ok: false,
        error: result.error,
        stage: result.stage,
        reportPath: result.reportPath ?? undefined,
      });
    } catch (e) {
      return res
        .status(500)
        .json({ ok: false, error: String(e?.message || e), stage: "build-preview" });
    }
  });

  app.get("/api/build-report/:slug", (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    const reportPath = path.join(PREVIEW_DIR, "build-reports", `${slug}.json`);
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ ok: false, error: "Build report not found" });
    }
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      return res.json({ ok: true, report });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Serve previews (with stage-aware artifacts or on-demand rebuild)
  // When ?stage= is present: serve raw artifact HTML for iframe.
  // When ?stage= is absent: serve full preview shell (toolbar + modal + iframe) so stage buttons work.
  app.get("/preview/:slug", (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      const file = path.join(PREVIEW_DIR, `${slug}.html`);
      const stageQuery = String(req?.query?.stage ?? "").trim().toLowerCase();
      const stageParam = stageQuery && ALLOWED_STAGES.has(stageQuery) ? stageQuery : null;

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
        const raw = fs.readFileSync(file, "utf8");
        const repaired = repairCachedPreviewHtml(raw);
        if (repaired !== raw) {
          try {
            fs.writeFileSync(file, repaired, "utf8");
          } catch {
            // Non-fatal: still serve repaired content from memory.
          }
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(repaired);
      }

      // If preview is missing, always go through the full Build & Open flow.
      // (Generate → Code-it → Improve → Fix pain points → Emit/Open preview)

      // No preview and no variants: show "Build required" with one-click build button
      const escapeHtml = (s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const escapedSlug = escapeHtml(slug);
      const buildRequiredHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Build required</title></head>
<body style="font-family:system-ui;padding:2rem;max-width:32rem;">
  <h1 style="font-size:1.25rem;">Preview not built</h1>
  <p>No preview file or variants found for <strong>${escapedSlug}</strong>. Run a full build to generate the preview.</p>
  <form id="build-form" method="post" action="/api/build-preview" style="margin-top:1rem;">
    <input type="hidden" name="slug" value="${escapedSlug}">
    <button type="submit" style="padding:0.5rem 1rem;cursor:pointer;">Build &amp; Open Preview</button>
  </form>
  <div id="build-progress" style="display:none;margin-top:1rem;">
    <div style="font-size:0.9rem;font-weight:600;margin-bottom:0.5rem;">Build progress</div>
    <ol id="build-steps" style="margin:0;padding-left:1.1rem;line-height:1.6;">
      <li data-stage="generate">Generate</li>
      <li data-stage="codeit">Code-it</li>
      <li data-stage="improve">Improve</li>
      <li data-stage="fix">Fix pain points</li>
      <li data-stage="emit">Emit preview HTML</li>
      <li data-stage="open_preview">Open preview</li>
    </ol>
    <div id="build-status" style="margin-top:0.5rem;color:#555;">Waiting…</div>
    <div style="margin-top:0.75rem;">
      <div style="font-size:0.85rem;font-weight:600;">Contracts running</div>
      <ul id="build-contracts" style="margin:0.25rem 0 0 0;padding-left:1.1rem;font-size:0.85rem;line-height:1.4;"></ul>
    </div>
    <div style="margin-top:0.75rem;">
      <div style="font-size:0.85rem;font-weight:600;">Auto-fixes applied</div>
      <ul id="build-fixes" style="margin:0.25rem 0 0 0;padding-left:1.1rem;font-size:0.85rem;line-height:1.4;"></ul>
    </div>
    <div style="margin-top:0.75rem;">
      <div style="font-size:0.85rem;font-weight:600;">Live log</div>
      <div id="build-events" style="margin-top:0.25rem;max-height:160px;overflow:auto;border:1px solid #ddd;border-radius:6px;padding:0.5rem;font-size:0.8rem;line-height:1.4;background:#fafafa;"></div>
    </div>
  </div>
  <p style="margin-top:1rem;color:#666;font-size:0.875rem;">This runs the full pipeline (Generate → Code-it → Improve → QA) then opens the preview.</p>
  <script>
    var POLL_MS = 600;
    function stageLabel(state) {
      if (state === "running") return " (running)";
      if (state === "completed") return " (done)";
      if (state === "failed") return " (failed)";
      if (state === "skipped") return " (skipped)";
      return "";
    }
    function applyProgress(report) {
      if (!report || typeof report !== "object") return;
      var progress = document.getElementById("build-progress");
      progress.style.display = "block";
      var nodes = document.querySelectorAll("#build-steps li[data-stage]");
      nodes.forEach(function(node) {
        var key = node.getAttribute("data-stage");
        var info = report.stages && report.stages[key] ? report.stages[key] : null;
        var status = info && info.status ? info.status : "pending";
        node.style.fontWeight = status === "running" ? "700" : "400";
        node.style.color = status === "failed" ? "#b00020" : status === "completed" ? "#0a7a2f" : "#111";
        var base = node.textContent.replace(/ \\(running\\)| \\(done\\)| \\(failed\\)| \\(skipped\\)/g, "");
        node.textContent = base + stageLabel(status);
      });
      var statusEl = document.getElementById("build-status");
      if (report.buildStatus === "failed") {
        statusEl.textContent = "Failed at " + (report.stage || "unknown") + ": " + (report.error || "Unknown error");
        statusEl.style.color = "#b00020";
      } else if (report.buildStatus === "completed") {
        statusEl.textContent = "Build complete.";
        statusEl.style.color = "#0a7a2f";
      } else {
        statusEl.textContent = "Running: " + (report.stage || "starting");
        statusEl.style.color = "#555";
      }

      var contractsList = document.getElementById("build-contracts");
      contractsList.innerHTML = "";
      var contractEntries = report.contracts && Array.isArray(report.contracts.entries)
        ? report.contracts.entries
        : [];
      if (!contractEntries.length) {
        var emptyContract = document.createElement("li");
        emptyContract.textContent = "Waiting for contract results…";
        contractsList.appendChild(emptyContract);
      } else {
        contractEntries.forEach(function(entry) {
          var li = document.createElement("li");
          li.textContent = (entry.name || "contract") + ": " + (entry.changedNodes || 0) + " changes, " + (entry.notesCount || 0) + " notes";
          contractsList.appendChild(li);
        });
      }

      var fixesList = document.getElementById("build-fixes");
      fixesList.innerHTML = "";
      var fixes = Array.isArray(report.autoFixesApplied) ? report.autoFixesApplied : [];
      if (!fixes.length) {
        var emptyFix = document.createElement("li");
        emptyFix.textContent = "No fixes yet.";
        fixesList.appendChild(emptyFix);
      } else {
        fixes.slice(0, 20).forEach(function(msg) {
          var li = document.createElement("li");
          li.textContent = String(msg || "");
          fixesList.appendChild(li);
        });
      }

      var eventsEl = document.getElementById("build-events");
      var events = Array.isArray(report.events) ? report.events : [];
      if (!events.length) {
        eventsEl.textContent = "Waiting for build logs…";
      } else {
        eventsEl.innerHTML = events.slice(-40).map(function(ev) {
          var m = ev.message ? " — " + ev.message : "";
          return "<div>[" + (ev.stage || "?") + "] " + (ev.status || "?") + m + "</div>";
        }).join("");
        eventsEl.scrollTop = eventsEl.scrollHeight;
      }
    }
    function startPolling(slug) {
      var active = true;
      function poll() {
        if (!active) return;
        fetch("/api/build-report/" + encodeURIComponent(slug))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(payload) {
            if (!payload || !payload.ok || !payload.report) return;
            applyProgress(payload.report);
          })
          .catch(function(){})
          .finally(function() { if (active) setTimeout(poll, POLL_MS); });
      }
      poll();
      return function stop(){ active = false; };
    }
    var building = false;
    function startBuild() {
      if (building) return;
      building = true;
      var form = document.getElementById("build-form");
      var slug = document.querySelector('input[name="slug"]').value;
      var btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = "Building…";
      var stopPolling = startPolling(slug);
      fetch("/api/build-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: slug }) })
        .then(function(r) {
          if (r.ok) return r.json();
          return r.json().then(function(j) { throw new Error(j.error || "Build failed"); });
        })
        .then(function(d) {
          stopPolling();
          window.location.href = d.previewUrl || "/preview/" + encodeURIComponent(slug);
        })
        .catch(function(err) {
          stopPolling();
          building = false;
          btn.disabled = false;
          btn.textContent = "Build & Open Preview";
          alert(err.message || "Build failed");
        });
    }
    document.getElementById("build-form").addEventListener("submit", function(e) {
      e.preventDefault();
      startBuild();
    });
    // Auto-run full pipeline immediately when preview is missing.
    startBuild();
  </script>
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(buildRequiredHtml);
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
