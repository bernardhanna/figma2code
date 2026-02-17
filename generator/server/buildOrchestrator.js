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
const STAGE_SEQUENCE = ["generate", "codeit", "improve", "refine", "fix", "emit", "open_preview"];

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

function normalizeRefineMode(raw) {
  const mode = String(raw || "").trim().toLowerCase();
  if (mode === "on" || mode === "ai" || mode === "preview+refine" || mode === "preview_refine") return "ai";
  return "off";
}

function resolveBaseUrl(inputs = {}) {
  const explicit = String(inputs.baseUrl || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.PORT || 5173}`;
}

async function defaultRunRefinePass({ slug, baseUrl, budget = {}, onDetail = () => {} }) {
  const endpoint = `${String(baseUrl || "").replace(/\/+$/, "")}/api/refine/${encodeURIComponent(slug)}`;
  const timeoutMs = Math.max(15000, Math.min(180000, Number(budget.timeoutMs || 90000)));
  const payload = {
    provider: "visual-optimizer",
    bucket: "all",
    maxIters: Math.max(1, Math.min(3, Number(budget.maxIters || 2))),
    topOffenders: Math.max(1, Math.min(25, Number(budget.topOffenders || 10))),
    passDiffRatio: Math.max(0.01, Math.min(0.03, Number(budget.passDiffRatio || 0.02))),
    epsilon: Math.max(0, Number(budget.epsilon || 0.0005)),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body = {};
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    body = await response.json().catch(() => ({}));
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      return {
        ok: false,
        skipped: true,
        reason: `refine timed out after ${Math.round(timeoutMs / 1000)}s`,
        status: 0,
        body: null,
      };
    }
    return {
      ok: false,
      skipped: true,
      reason: `refine endpoint unavailable: ${String(error?.message || error)}`,
      status: 0,
      body: null,
    };
  } finally {
    clearTimeout(timeout);
  }
  const iterations = Array.isArray(body?.iterations) ? body.iterations : [];
  iterations.slice(0, 30).forEach((it) => {
    const iter = Number(it?.iteration || it?.iter || 0);
    const accepted = it?.accepted === true ? "accepted" : "rejected";
    onDetail(`ai refine iter ${iter || "?"}: ${accepted}`);
  });
  if (!response.ok) {
    return {
      ok: false,
      skipped: true,
      reason: String(body?.error || body?.stoppedReason || `refine returned status ${response.status}`),
      status: response.status,
      body,
    };
  }
  return {
    ok: true,
    skipped: false,
    reason: "",
    status: response.status,
    body,
  };
}

function contractEntriesFromCodeit(codeitArtifact) {
  const rows = Array.isArray(codeitArtifact?.diagnostics?.contracts?.results)
    ? codeitArtifact.diagnostics.contracts.results
    : [];
  return rows.map((row) => ({
    name: String(row?.id || "").trim(),
    status: row?.accepted === false ? (row?.regressed ? "skipped" : "failed") : "done",
    accepted: row?.accepted !== false,
    regressed: row?.regressed === true,
    changedNodes: Array.isArray(row?.changes) ? row.changes.length : 0,
    notesCount: Array.isArray(row?.warnings) ? row.warnings.length : 0,
  }));
}

function testEntriesFromCodeit(codeitArtifact) {
  const t = codeitArtifact?.diagnostics?.contractTests || null;
  if (!t || typeof t !== "object") {
    return [{ name: "codeit.contractTests", status: "skipped", summary: "Not reported" }];
  }
  return [
    {
      name: "codeit.contractTests",
      status: String(t.status || "skipped"),
      summary: String(t.summary || ""),
      total: Number(t.total || 0),
      passed: Number(t.passed || 0),
      failed: Number(t.failed || 0),
      skipped: Number(t.skipped || 0),
      failures: Array.isArray(t.failures) ? t.failures.slice(0, 25) : [],
    },
  ];
}

export async function runBuildAndPreview(inputs = {}) {
  const slug = String(inputs.slug || "").trim();
  if (!slug) {
    return { ok: false, error: "Missing slug", stage: "inputs" };
  }

  const refineMode = normalizeRefineMode(inputs.refineMode);
  const baseUrl = resolveBaseUrl(inputs);
  const runRefinePassFn =
    typeof inputs.runRefinePassFn === "function" ? inputs.runRefinePassFn : defaultRunRefinePass;

  const reportPath = path.join(BUILD_REPORTS_DIR, `${slug}.json`);
  const startTime = Date.now();
  const timings = {};
  const warnings = [];
  const autoFixesApplied = [];
  const events = [];
  let lastStage = "generate";
  let buildStatus = "running";
  let contractsSummary = { totals: { changedNodes: 0, notes: 0 }, entries: [] };
  let testsSummary = { entries: [] };
  let checksSummary = { entries: [] };
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
      tests: testsSummary,
      checks: checksSummary,
      outputPaths: overrides.outputPaths ?? {},
      reportPath,
      refineMode,
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
    await runStage({
      slug,
      stage: "codeit",
      log: (line) => {
        const message = String(line || "").trim();
        if (!message) return;
        events.push({
          ts: new Date().toISOString(),
          stage: "codeit",
          status: "detail",
          message,
        });
        writeReport({ ok: false, stage: lastStage });
      },
      onProgress: (payload) => {
        if (!payload || typeof payload !== "object") return;
        const now = new Date().toISOString();
        if (payload.type === "test") {
          const name = String(payload.scope || "codeit.contractTests");
          const status = String(payload.status || "running");
          testsSummary = {
            entries: [
              {
                name,
                status,
                summary: String(payload.message || ""),
              },
            ],
          };
          events.push({ ts: now, stage: "codeit", status, message: `${name}: ${payload.message || status}` });
        } else if (payload.type === "contract") {
          const name = String(payload.id || "").trim();
          if (!name) return;
          const status = String(payload.status || "running");
          const existing = Array.isArray(contractsSummary.entries) ? [...contractsSummary.entries] : [];
          const idx = existing.findIndex((entry) => entry.name === name);
          const next = {
            name,
            status,
            changedNodes: Number(payload.changedNodes || 0),
            notesCount: Number(payload.warnings || 0),
          };
          if (idx >= 0) existing[idx] = { ...existing[idx], ...next };
          else existing.push(next);
          contractsSummary = {
            ...contractsSummary,
            entries: existing,
          };
          events.push({ ts: now, stage: "codeit", status, message: `${name}: ${status}` });
        }
        writeReport({ ok: false, stage: lastStage });
      },
    });
    const codeitArtifact = readArtifact(slug, "codeit");
    testsSummary = { entries: testEntriesFromCodeit(codeitArtifact) };
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

    // 4) Optional AI refine (bounded, trial-gated in /api/refine, never blocks preview)
    lastStage = "refine";
    if (refineMode !== "ai") {
      timings.refine = 0;
      markStage("refine", "skipped", "Refine mode off");
    } else {
      markStage("refine", "running", "AI refine requested");
      const tRefine = Date.now();
      const improveMetrics =
        improveArtifact?.metrics?.offenders || codeitArtifact?.metrics?.offenders || [];
      const impactful = Array.isArray(improveMetrics)
        ? improveMetrics.filter((o) => Number(o?.impact || 0) >= 50)
        : [];
      if (!impactful.length) {
        timings.refine = Date.now() - tRefine;
        markStage("refine", "skipped", "No offenders above impact threshold");
        events.push({
          ts: new Date().toISOString(),
          stage: "refine",
          status: "skipped",
          message: "Skipped AI refine: no offenders above impact threshold.",
        });
      } else {
        const refine = await runRefinePassFn({
          slug,
          baseUrl,
          budget: {
            maxIters: 2,
            topOffenders: 12,
            passDiffRatio: 0.02,
            epsilon: 0.0005,
            timeoutMs: 90000,
          },
          onDetail: (message) => {
            events.push({
              ts: new Date().toISOString(),
              stage: "refine",
              status: "detail",
              message,
            });
            writeReport({ ok: false, stage: lastStage });
          },
        });
        timings.refine = Date.now() - tRefine;
        if (refine.ok) {
          markStage("refine", "completed", "AI refine completed");
          autoFixesApplied.push("refine: AI refine accepted bounded improvements");
        } else {
          markStage("refine", "skipped", refine.reason || "AI refine unavailable");
          warnings.push(`AI refine skipped: ${refine.reason || "no details"}`);
        }
      }
    }

    // 5) Fix pain points on final artifact HTML
    lastStage = "fix";
    markStage("fix", "running");
    const t3 = Date.now();
    const sourceArtifact =
      readArtifact(slug, "improve") ||
      improveArtifact ||
      codeitArtifact ||
      readArtifact(slug, "generate");
    const basePreviewHtml = String(sourceArtifact?.html || "");
    if (!basePreviewHtml) {
      throw new Error(`Missing artifact HTML for "${slug}" after improve stage.`);
    }
    const envelope = resolveHtmlEnvelope(basePreviewHtml);
    const qaResult = runQAGate(envelope.fragment, { maxPasses: 3, diffMaxLines: 500 });
    const finalPreviewHtml = envelope.apply(qaResult.fixedHtml);
    const beforeErrors = Number(qaResult?.reportBefore?.summary?.error || 0);
    const beforeFatal = Number(
      Array.isArray(qaResult?.reportBefore?.issues)
        ? qaResult.reportBefore.issues.filter((i) => i && i.fatal).length
        : 0
    );
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
    checksSummary = {
      entries: [
        {
          name: "qa.audit.before",
          status: beforeErrors === 0 && beforeFatal === 0 ? "pass" : "done",
          summary: `${beforeErrors} errors, ${beforeFatal} fatal`,
        },
        {
          name: "qa.autofix",
          status: qaSummary.appliedFixesCount > 0 ? "done" : "skipped",
          summary: `${qaSummary.appliedFixesCount} deterministic fixes`,
        },
        {
          name: "qa.audit.after",
          status: qaSummary.remainingErrors === 0 && qaSummary.remainingFatal === 0 ? "pass" : "fail",
          summary: `${qaSummary.remainingErrors} errors, ${qaSummary.remainingFatal} fatal`,
        },
      ],
    };
    checksSummary.entries.forEach((entry) => {
      events.push({
        ts: new Date().toISOString(),
        stage: "fix",
        status: entry.status,
        message: `${entry.name}: ${entry.summary}`,
      });
    });
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

    // 6) Emit preview
    lastStage = "emit";
    markStage("emit", "running");
    const t4 = Date.now();
    ensureDir(PREVIEW_DIR);
    const previewOut = path.join(PREVIEW_DIR, `${slug}.html`);
    fs.writeFileSync(previewOut, finalPreviewHtml, "utf8");
    timings.emit = Date.now() - t4;
    markStage("emit", "completed");

    // 7) Open preview (bookkeeping only)
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
