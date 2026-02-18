const path = require("path");
const { pathToFileURL } = require("url");
const { spawnSync } = require("child_process");
const fs = require("fs");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION, assertValidArtifact } = require(
  "../artifacts/validate"
);
const { evaluate: defaultEvaluate } = require("../services/evaluate");
const { createReporter, CODEIT, codeitContractStep } = require("../progress");
const { getArtifactPath, readInputArtifact, writeArtifact } = require("./io");
const config = require("./stage.config");
const { createLedger, summarizeLedger } = require("./contracts/utilities/changesLedger");

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const loadGeneratorModule = async (relativePath) => {
  const fullPath = path.resolve(__dirname, "..", "..", "generator", relativePath);
  return import(pathToFileURL(fullPath).href);
};

const loadContract = (entry) => {
  if (typeof entry === "string") {
    return { id: entry, modulePath: entry, options: {} };
  }
  const id = String(entry?.id || entry?.path || "").trim();
  const modulePath = String(entry?.path || entry?.id || "").trim();
  return {
    id,
    modulePath,
    options: isPlainObject(entry?.options) ? entry.options : {},
  };
};

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

const SRC_DOC_REGEX = /<iframe[^>]*\bsrcdoc=(["'])([\s\S]*?)\1/i;
const BODY_REGEX = /<body([^>]*)>([\s\S]*?)<\/body>/i;

const resolveHtmlEnvelope = (previewHtml) => {
  const html = String(previewHtml || "");
  const iframeMatch = html.match(SRC_DOC_REGEX);
  if (!iframeMatch) {
    const bodyMatch = html.match(BODY_REGEX);
    if (!bodyMatch) {
      return {
        fragment: html,
        apply: (fragment) => String(fragment || ""),
      };
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
};

const buildDeltas = (baseline, current) => {
  if (!baseline || !current) return {};
  const deltas = {};

  ["mobile", "tablet", "desktop"].forEach((bp) => {
    const before = baseline?.breakpoints?.[bp];
    const after = current?.breakpoints?.[bp];
    if (!before || !after) return;

    const beforeRatio = before?.visual?.pixelDiffRatio?.value;
    const afterRatio = after?.visual?.pixelDiffRatio?.value;

    deltas[bp] = {
      visual: {
        pixelDiffRatio: {
          before: typeof beforeRatio === "number" ? beforeRatio : null,
          after: typeof afterRatio === "number" ? afterRatio : null,
          delta:
            typeof beforeRatio === "number" && typeof afterRatio === "number"
              ? afterRatio - beforeRatio
              : null,
        },
      },
      layout: {
        fixedHeightWrapperCount:
          (after?.layout?.fixedHeightWrapperCount || 0) -
          (before?.layout?.fixedHeightWrapperCount || 0),
        overflowXCount:
          (after?.layout?.overflowXCount || 0) - (before?.layout?.overflowXCount || 0),
        conflictingWidthCount:
          (after?.layout?.conflictingWidthCount || 0) -
          (before?.layout?.conflictingWidthCount || 0),
      },
      type: {
        wrapAnomalyCount:
          (after?.type?.wrapAnomalyCount || 0) - (before?.type?.wrapAnomalyCount || 0),
      },
      a11y: {
        total: (after?.a11y?.total || 0) - (before?.a11y?.total || 0),
      },
    };
  });

  return deltas;
};

const resolveGateConfig = (gate) => {
  const base = isPlainObject(gate) ? gate : {};
  const maxVisualDeltaRaw = process.env.CODEIT_VISUAL_TOLERANCE || base.maxVisualDelta;
  const maxVisualDelta = Number(maxVisualDeltaRaw);
  const revertEnv = String(process.env.CODEIT_GATE_REVERT || "").trim();

  return {
    enabled: base.enabled !== false,
    maxVisualDelta: Number.isFinite(maxVisualDelta) ? maxVisualDelta : 0.002,
    revertOnRegression: revertEnv ? revertEnv !== "0" : base.revertOnRegression !== false,
  };
};

const detectRegression = (baseline, next, tolerance) => {
  if (!baseline || !next) return { regressed: false };
  const breakpoints = ["mobile", "tablet", "desktop"];
  let worst = null;

  breakpoints.forEach((bp) => {
    const before = baseline?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    const after = next?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    if (typeof before !== "number" || typeof after !== "number") return;
    const delta = after - before;
    if (!worst || delta > worst.delta) {
      worst = { breakpoint: bp, delta, before, after };
    }
  });

  return {
    regressed: !!(worst && worst.delta > tolerance),
    worst,
  };
};

const formatRatio = (value) =>
  typeof value === "number" ? value.toFixed(4) : "—";

const formatDelta = (value) => {
  if (typeof value !== "number") return "—";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(4)}`;
};

const formatFixLine = (group) => {
  const reason = String(group?.reason || "").trim();
  if (!reason) return "";
  const prefix = reason.match(/^(Removed|Resolved)\s+(.+)$/);
  if (prefix) {
    return `${prefix[1]} ${group.count} ${prefix[2]}.`;
  }
  const nodes = Array.isArray(group?.nodes) ? group.nodes : [];
  if (!nodes.length) return `${reason}.`;
  const list = nodes.slice(0, 4).join(", ");
  const suffix = nodes.length > 4 ? ", …" : "";
  return `${reason} (nodes: ${list}${suffix}).`;
};

const normalizeWarnings = (warnings, contractId) => {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((warning) => {
      if (typeof warning === "string") {
        return { contractId, message: warning };
      }
      if (warning && typeof warning === "object") {
        const message = String(warning.message || warning.warning || "").trim();
        return {
          contractId: warning.contractId || contractId,
          message: message || JSON.stringify(warning),
          ...warning,
        };
      }
      return null;
    })
    .filter(Boolean);
};

const run = async ({
  slug,
  evaluateFn = defaultEvaluate,
  readInputArtifactFn = readInputArtifact,
  writeArtifactFn = writeArtifact,
  validateTailwindClassesFn,
  configOverride,
  log = console.log,
  onProgress,
} = {}) => {
  const logFn = typeof log === "function" ? log : () => {};
  const progressFn = typeof onProgress === "function" ? onProgress : null;
  const emitProgress = (payload) => {
    if (!progressFn || !payload || typeof payload !== "object") return;
    try {
      progressFn(payload);
    } catch {
      // Non-fatal progress hooks must never break pipeline execution.
    }
  };
  const reporter = createReporter(logFn);
  const stageConfig = configOverride ? { ...config, ...configOverride } : config;

  const repoRoot = path.resolve(__dirname, "..", "..");
  const testsDir = path.join(__dirname, "contracts", "__tests__");
  let contractTests = {
    status: "skipped",
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    summary: "Contract tests directory not found.",
  };
  if (fs.existsSync(testsDir)) {
    emitProgress({
      type: "test",
      scope: "codeit.contractTests",
      status: "running",
      message: "Running contract tests",
    });
    reporter.step(CODEIT.CONTRACT_TESTS);
    const testResult = spawnSync(process.execPath, ["--test", testsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    const out = [testResult.stdout, testResult.stderr].filter(Boolean).join("\n");
    const passedCount = (out.match(/^ok \d+ - /gm) || []).length;
    const failedRows = (out.match(/^not ok \d+ - (.+)$/gm) || []).map((line) =>
      line.replace(/^not ok \d+ - /, "").trim()
    );
    const skippedCount = (out.match(/^# SKIP/gm) || []).length;
    if (testResult.status !== 0) {
      const summary = failedRows.length
        ? `Failed (${failedRows.length}): ${failedRows.slice(0, 10).join("; ")}${failedRows.length > 10 ? "…" : ""}`
        : `Exit ${testResult.status}`;
      contractTests = {
        status: "failed",
        total: passedCount + failedRows.length,
        passed: passedCount,
        failed: failedRows.length || 1,
        skipped: skippedCount,
        failures: failedRows.slice(0, 25),
        summary,
      };
      if (logFn && out) logFn(out);
      emitProgress({
        type: "test",
        scope: "codeit.contractTests",
        status: "failed",
        message: summary,
      });
      reporter.fail(CODEIT.CONTRACT_TESTS, new Error(summary));
      throw new Error(`Contract tests failed. ${summary}. Code it aborted.`);
    }
    contractTests = {
      status: "passed",
      total: passedCount + failedRows.length,
      passed: passedCount,
      failed: failedRows.length,
      skipped: skippedCount,
      failures: [],
      summary: `Passed ${passedCount}/${passedCount + failedRows.length || passedCount}`,
    };
    emitProgress({
      type: "test",
      scope: "codeit.contractTests",
      status: "passed",
      message: contractTests.summary,
    });
    reporter.succeed(CODEIT.CONTRACT_TESTS);
  } else {
    emitProgress({
      type: "test",
      scope: "codeit.contractTests",
      status: "skipped",
      message: "Contract tests directory not found",
    });
  }

  reporter.succeed(CODEIT.LOAD_ARTIFACT);
  const inputArtifact = readInputArtifactFn(slug);
  assertValidArtifact(inputArtifact);

  const baseHtml = typeof inputArtifact.html === "string" ? inputArtifact.html : "";
  const envelope = resolveHtmlEnvelope(baseHtml);
  let html = envelope.fragment;

  reporter.succeed(CODEIT.PREPARE_RUNNER);
  const contractEntries = Array.isArray(stageConfig.contracts) ? stageConfig.contracts : [];
  const contractResults = [];
  const ledger = createLedger();
  const warnings = [];
  const errors = [];

  let currentMetrics = isPlainObject(inputArtifact.metrics) ? inputArtifact.metrics : null;
  const gate = resolveGateConfig(stageConfig.gate);

  for (const entry of contractEntries) {
    const { id, modulePath, options } = loadContract(entry);
    if (!modulePath) continue;
    const contractId = id || modulePath;
    emitProgress({
      type: "contract",
      scope: "codeit",
      id: contractId,
      status: "running",
      message: `Running ${contractId}`,
    });

    const contractLabel = codeitContractStep(contractId);
    if (contractLabel) reporter.succeed(contractLabel);
    try {
      const fullPath = path.resolve(__dirname, modulePath);
      const mod = require(fullPath);
      const apply = typeof mod.apply === "function" ? mod.apply : mod.default?.apply;
      if (typeof apply !== "function") {
        throw new Error(`Contract ${contractId} missing apply()`);
      }

      const result = apply({ html, artifact: inputArtifact, options });
      const candidateHtml = result && typeof result.html === "string" ? result.html : html;
      const changes = Array.isArray(result?.changes) ? result.changes : [];
      const contractWarnings = normalizeWarnings(result?.warnings, contractId);
      const stats = isPlainObject(result?.stats) ? result.stats : {};

      let accepted = true;
      let regressed = false;

      if (gate.enabled && candidateHtml !== html) {
        const evaluation = evaluateFn({
          slug,
          html: envelope.apply(candidateHtml),
          artifact: inputArtifact,
        });
        const regression = detectRegression(currentMetrics, evaluation?.metrics, gate.maxVisualDelta);
        regressed = regression.regressed;

        if (regressed && regression.worst) {
          const msg = `Regression gate: ${contractId} increased visual diff on ${
            regression.worst.breakpoint
          } by ${formatDelta(regression.worst.delta)} (from ${formatRatio(
            regression.worst.before
          )} to ${formatRatio(regression.worst.after)}).`;
          contractWarnings.push({
            contractId,
            message: msg,
            breakpoint: regression.worst.breakpoint,
            delta: regression.worst.delta,
          });
          if (gate.revertOnRegression) {
            accepted = false;
          }
        }

        if (accepted && isPlainObject(evaluation?.metrics)) {
          currentMetrics = evaluation.metrics;
        }
      }

      if (accepted) {
        html = candidateHtml;
        ledger.addMany(changes);
      }

      warnings.push(...contractWarnings);

      contractResults.push({
        id: contractId,
        accepted,
        regressed,
        changes: accepted ? changes : [],
        warnings: contractWarnings,
        stats,
      });
      emitProgress({
        type: "contract",
        scope: "codeit",
        id: contractId,
        status: !accepted && regressed ? "skipped" : "done",
        changedNodes: accepted ? changes.length : 0,
        warnings: contractWarnings.length,
      });
    } catch (err) {
      emitProgress({
        type: "contract",
        scope: "codeit",
        id: contractId,
        status: "failed",
        message: String(err?.message || err),
      });
      throw err;
    }
  }

  reporter.succeed(CODEIT.VALIDATION);
  let validation = null;
  let validate = validateTailwindClassesFn;
  if (!validate) {
    try {
      const mod = await loadGeneratorModule("server/tailwindPreflight.js");
      validate = mod.validateTailwindClasses;
    } catch {
      validate = null;
    }
  }

  if (typeof validate === "function") {
    validation = validate(html);
    if (Array.isArray(validation?.warnings) && validation.warnings.length) {
      warnings.push(
        ...validation.warnings.map((message) => ({
          contractId: "validation",
          message: String(message),
        }))
      );
    }
  }

  reporter.succeed(CODEIT.EVALUATE);
  const evaluation = evaluateFn({
    slug,
    html: envelope.apply(html),
    artifact: inputArtifact,
  });
  const missingVisualDiff = Array.isArray(evaluation?.diagnostics?.visualDiff?.missing)
    ? evaluation.diagnostics.visualDiff.missing
    : [];
  missingVisualDiff.forEach((entry) => {
    const bp = String(entry?.breakpoint || "unknown");
    const reason = String(entry?.reason || "missing-visual-diff");
    const scorePaths = Array.isArray(entry?.searched?.scoreFiles) ? entry.searched.scoreFiles : [];
    const figmaPaths = Array.isArray(entry?.searched?.figmaFiles) ? entry.searched.figmaFiles : [];
    const renderPaths = Array.isArray(entry?.searched?.renderFiles) ? entry.searched.renderFiles : [];
    const parseError = entry?.parseError ? ` parseError=${entry.parseError}` : "";
    warnings.push({
      contractId: "evaluate.visualDiff",
      message:
        `Evaluate visual diff missing for ${bp}: reason=${reason}.` +
        ` scorePaths=${scorePaths.slice(0, 3).join(" | ") || "none"}` +
        ` figmaPaths=${figmaPaths.slice(0, 2).join(" | ") || "none"}` +
        ` renderPaths=${renderPaths.slice(0, 2).join(" | ") || "none"}` +
        parseError,
    });
  });

  reporter.succeed(CODEIT.WRITE_ARTIFACT);

  const containerResult = contractResults.find(
    (r) => (r.id || "").trim() === "layout/container/addMxAuto"
  );
  if (
    containerResult &&
    typeof containerResult.stats?.added === "number" &&
    containerResult.stats.added > 0
  ) {
    const nodeIds = [
      ...new Set(
        (containerResult.changes || [])
          .map((c) => c.nodeId)
          .filter(Boolean)
      ),
    ];
    const nodeList = nodeIds.length ? ` (nodes: ${nodeIds.slice(0, 5).join(", ")}${nodeIds.length > 5 ? ", …" : ""})` : "";
    warnings.push({
      contractId: "layout/container/addMxAuto",
      message: `Container canonicalizer: w-full + max-w without mx-auto${nodeList}`,
    });
  }

  const baseDiagnostics = isPlainObject(inputArtifact.diagnostics)
    ? inputArtifact.diagnostics
    : {};
  const baseMetrics = isPlainObject(inputArtifact.metrics) ? inputArtifact.metrics : {};
  const finalMetrics = isPlainObject(evaluation?.metrics) ? evaluation.metrics : {};
  const deltas = buildDeltas(baseMetrics, finalMetrics);

  const artifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: envelope.apply(html),
    patches: Array.isArray(inputArtifact.patches) ? inputArtifact.patches : [],
    assets: isPlainObject(inputArtifact.assets) ? inputArtifact.assets : {},
    diagnostics: {
      ...baseDiagnostics,
      warnings,
      errors,
      validation,
      ledger: ledger.entries,
      contracts: {
        order: contractResults.map((entry) => entry.id),
        results: contractResults,
        totals: {
          changes: ledger.entries.length,
          warnings: warnings.length,
        },
      },
      contractTests,
      evaluation: isPlainObject(evaluation?.diagnostics) ? evaluation.diagnostics : {},
    },
    metrics: {
      ...baseMetrics,
      ...finalMetrics,
      deltas,
    },
  };

  if (isPlainObject(inputArtifact.nodeIndex)) {
    artifact.nodeIndex = inputArtifact.nodeIndex;
  }

  assertValidArtifact(artifact);
  writeArtifactFn(slug, artifact);

  reporter.succeed(CODEIT.DONE);

  const fixGroups = summarizeLedger(ledger.entries).sort((a, b) => b.count - a.count);
  const scorePerBreakpoint = {};
  ["mobile", "tablet", "desktop"].forEach((bp) => {
    const score = finalMetrics?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    const delta = deltas?.[bp]?.visual?.pixelDiffRatio?.delta;
    scorePerBreakpoint[bp] =
      typeof score === "number" ? `${formatRatio(score)} (delta ${formatDelta(delta)})` : "—";
  });

  reporter.writeSummary({
    errors,
    warnings,
    fixCount: ledger.entries.length,
    fixGroups,
    formatFixLine: (group) => formatFixLine(group),
    artifactsPath: getArtifactPath(slug),
    scorePerBreakpoint,
  });

  return artifact;
};

module.exports = {
  run,
};
