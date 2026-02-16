import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { PREVIEW_DIR, ROOT } from "./runtimePaths.js";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(ROOT, "..");
const { runStage } = require(path.join(REPO_ROOT, "pipeline", "orchestrator", "runStage.js"));
const qaGate = require(path.join(REPO_ROOT, "pipeline", "qaGate", "index.js"));
const runQAGate = qaGate.runQAGate;

const BUILD_REPORTS_DIR = path.join(PREVIEW_DIR, "build-reports");
const STAGE_SEQUENCE = ["generate", "codeit", "improve", "fix", "emit", "open_preview"];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function artifactPath(slug, stage) {
  return path.join(REPO_ROOT, "fixtures.out", slug, `artifact.${stage}.json`);
}

function readArtifact(slug, stage) {
  const file = artifactPath(slug, stage);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const SRC_DOC_REGEX = /<iframe[^>]*\bsrcdoc=(["'])([\s\S]*?)\1/i;
const BODY_REGEX = /<body([^>]*)>([\s\S]*?)<\/body>/i;
const decodeSrcdocAttr = (value) =>
  String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const encodeSrcdocAttr = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function resolveHtmlEnvelope(previewHtml) {
  const html = String(previewHtml || "");
  const iframeMatch = html.match(SRC_DOC_REGEX);
  if (!iframeMatch) {
    const bodyMatch = html.match(BODY_REGEX);
    if (!bodyMatch) {
      return { fragment: html, apply: (fragment) => String(fragment || "") };
    }
    const bodyAttrs = bodyMatch[1] || "";
    const fragment = bodyMatch[2] || "";
    return {
      fragment,
      apply: (nextFragment) =>
        html.replace(BODY_REGEX, () => `<body${bodyAttrs}>${String(nextFragment || "")}</body>`),
    };
  }
  const srcdocEscaped = iframeMatch[2] || "";
  const srcdoc = decodeSrcdocAttr(srcdocEscaped);
  const bodyMatch = srcdoc.match(BODY_REGEX);
  const bodyAttrs = bodyMatch ? bodyMatch[1] || "" : "";
  const fragment = bodyMatch ? bodyMatch[2] || "" : srcdoc;
  return {
    fragment,
    apply: (nextFragment) => {
      const next = bodyMatch
        ? srcdoc.replace(BODY_REGEX, () => `<body${bodyAttrs}>${String(nextFragment || "")}</body>`)
        : String(nextFragment || "");
      const encoded = encodeSrcdocAttr(next);
      return html.replace(SRC_DOC_REGEX, (match, quote, value) => {
        const start = match.indexOf(value);
        if (start === -1) return match;
        return match.slice(0, start) + encoded + match.slice(start + value.length);
      });
    },
  };
}

function normalizeWarnings(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry?.message) return String(entry.message);
      return "";
    })
    .filter(Boolean);
}

function contractEntriesFromCodeit(codeitArtifact) {
  const rows = Array.isArray(codeitArtifact?.diagnostics?.contracts?.results)
    ? codeitArtifact.diagnostics.contracts.results
    : [];
  return rows.map((row) => ({
    name: String(row?.id || "").trim(),
    changedNodes: Array.isArray(row?.changes) ? row.changes.length : 0,
    notesCount: Array.isArray(row?.warnings) ? row.warnings.length : 0,
  }));
}

export async function runBuildAndPreview(inputs = {}) {
  const slug = String(inputs.slug || "").trim();
  if (!slug) {
    return { ok: false, error: "Missing slug", stage: "inputs" };
  }

  const reportPath = path.join(BUILD_REPORTS_DIR, `${slug}.json`);
  const startTime = Date.now();
  const timings = {};
  const warnings = [];
  const autoFixesApplied = [];
  const events = [];
  let lastStage = "generate";
  let buildStatus = "running";
  let contractsSummary = { totals: { changedNodes: 0, notes: 0 }, entries: [] };
  let qaSummary = {
    appliedFixesCount: 0,
    appliedFixes: [],
    remainingErrors: 0,
    remainingFatal: 0,
    byRule: {},
  };

  const stages = Object.fromEntries(
    STAGE_SEQUENCE.map((name) => [name, { status: "pending", startedAt: null, endedAt: null }])
  );

  const writeReport = (overrides = {}) => {
    ensureDir(BUILD_REPORTS_DIR);
    const report = {
      slug,
      ok: overrides.ok ?? false,
      stage: overrides.stage ?? lastStage,
      error: overrides.error ?? null,
      timings: { ...timings },
      stages,
      buildStatus,
      updatedAt: new Date().toISOString(),
      warnings: [...warnings],
      autoFixesApplied: [...autoFixesApplied],
      events: [...events],
      qa: qaSummary,
      contracts: contractsSummary,
      outputPaths: overrides.outputPaths ?? {},
      reportPath,
      ...overrides.reportExtra,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    return reportPath;
  };

  const markStage = (stage, status, message = "") => {
    if (!stages[stage]) return;
    const now = new Date().toISOString();
    stages[stage] = {
      ...stages[stage],
      status,
      startedAt: status === "running" ? now : stages[stage].startedAt,
      endedAt:
        status === "completed" || status === "failed" || status === "skipped" ? now : stages[stage].endedAt,
    };
    events.push({
      ts: now,
      stage,
      status,
      message: message || undefined,
    });
    writeReport({ ok: false, stage: lastStage });
  };

  try {
    writeReport({ ok: false, stage: lastStage });

    // 1) Generate artifact
    lastStage = "generate";
    markStage("generate", "running");
    const t0 = Date.now();
    await runStage({ slug, stage: "generate" });
    timings.generate = Date.now() - t0;
    markStage("generate", "completed");

    // 2) Code-it artifact (canonical contracts pipeline)
    lastStage = "codeit";
    markStage("codeit", "running");
    const t1 = Date.now();
    await runStage({ slug, stage: "codeit" });
    const codeitArtifact = readArtifact(slug, "codeit");
    contractsSummary = {
      totals: {
        changedNodes: Number(codeitArtifact?.diagnostics?.contracts?.totals?.changes || 0),
        notes: Number(codeitArtifact?.diagnostics?.contracts?.totals?.warnings || 0),
      },
      entries: contractEntriesFromCodeit(codeitArtifact),
    };
    contractsSummary.entries.forEach((entry) => {
      events.push({
        ts: new Date().toISOString(),
        stage: "codeit",
        status: "detail",
        message: `${entry.name}: ${entry.changedNodes} changes, ${entry.notesCount} warnings`,
      });
    });
    if (contractsSummary.totals.changedNodes > 0) {
      autoFixesApplied.push(`contracts: ${contractsSummary.totals.changedNodes} nodes updated`);
    }
    warnings.push(...normalizeWarnings(codeitArtifact?.diagnostics?.warnings));
    timings.codeit = Date.now() - t1;
    markStage("codeit", "completed");

    // 3) Improve artifact
    lastStage = "improve";
    markStage("improve", "running");
    const t2 = Date.now();
    await runStage({ slug, stage: "improve" });
    const improveArtifact = readArtifact(slug, "improve");
    warnings.push(...normalizeWarnings(improveArtifact?.diagnostics?.warnings));
    timings.improve = Date.now() - t2;
    markStage("improve", "completed");

    // 4) Fix pain points on final artifact HTML
    lastStage = "fix";
    markStage("fix", "running");
    const t3 = Date.now();
    const sourceArtifact = improveArtifact || codeitArtifact || readArtifact(slug, "generate");
    const basePreviewHtml = String(sourceArtifact?.html || "");
    if (!basePreviewHtml) {
      throw new Error(`Missing artifact HTML for "${slug}" after improve stage.`);
    }
    const envelope = resolveHtmlEnvelope(basePreviewHtml);
    const qaResult = runQAGate(envelope.fragment, { maxPasses: 3, diffMaxLines: 500 });
    const finalPreviewHtml = envelope.apply(qaResult.fixedHtml);
    qaSummary = {
      appliedFixesCount: Array.isArray(qaResult.appliedFixes) ? qaResult.appliedFixes.length : 0,
      appliedFixes: Array.isArray(qaResult.appliedFixes)
        ? qaResult.appliedFixes.map((f) => ({
            issueId: f?.issueId || "",
            action: f?.action || "",
          }))
        : [],
      remainingErrors: Number(qaResult.remainingErrors || 0),
      remainingFatal: Number(qaResult.remainingFatal || 0),
      byRule: qaResult.byRule || {},
    };
    if (qaSummary.appliedFixesCount > 0) {
      autoFixesApplied.push(`qa: ${qaSummary.appliedFixesCount} fixes applied`);
      qaSummary.appliedFixes.forEach((f) => {
        if (f.action) {
          autoFixesApplied.push(`qa: ${f.action}`);
          events.push({
            ts: new Date().toISOString(),
            stage: "fix",
            status: "detail",
            message: f.action,
          });
        }
      });
    }
    if (qaSummary.remainingErrors || qaSummary.remainingFatal) {
      warnings.push(
        `QA remaining: ${qaSummary.remainingErrors} errors, ${qaSummary.remainingFatal} fatal`
      );
    }
    timings.fix = Date.now() - t3;
    markStage("fix", "completed");

    // 5) Emit preview
    lastStage = "emit";
    markStage("emit", "running");
    const t4 = Date.now();
    ensureDir(PREVIEW_DIR);
    const previewOut = path.join(PREVIEW_DIR, `${slug}.html`);
    fs.writeFileSync(previewOut, finalPreviewHtml, "utf8");
    timings.emit = Date.now() - t4;
    markStage("emit", "completed");

    // 6) Open preview (bookkeeping only)
    lastStage = "open_preview";
    markStage("open_preview", "running");
    timings.open_preview = 0;
    markStage("open_preview", "completed");

    timings.total = Date.now() - startTime;
    buildStatus = "completed";
    writeReport({
      ok: true,
      stage: "open_preview",
      outputPaths: { preview: previewOut, report: reportPath },
    });
    return { ok: true, slug, reportPath };
  } catch (e) {
    const errMsg = String(e?.message || e);
    markStage(lastStage, "failed", errMsg);
    buildStatus = "failed";
    writeReport({ ok: false, error: errMsg, stage: lastStage });
    return { ok: false, error: errMsg, stage: lastStage, reportPath };
  }
}
