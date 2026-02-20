// generator/qa/loop.js — Visual QA + Auto-Fix loop runner

import fs from "node:fs";
import path from "node:path";
import { ROOT, PREVIEW_DIR, VDIFF_DIR } from "../server/runtimePaths.js";
import { runBuildAndPreview } from "../server/buildOrchestrator.js";
import { readStage } from "../server/stageStore.js";
import { loadCompareDeps } from "../server/visualDiffDeps.js";
import { captureLayoutJson } from "../server/visualDiffLayoutCapture.js";
import { clusterOffendersFromLayout } from "./cluster.js";
import { writeExpectedRects } from "./expected.js";
import {
  createPatch,
  resolveToNodeId,
  mergePatchIntoMap,
  writePatchesFile,
  rollbackPatchesFile,
} from "./patch.js";
import { runConstraintEngine } from "../constraints/engine.js";
import { validatePatchShape } from "../constraints/utils.js";
import {
  DEFAULT_PASS_DIFF_RATIO,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_PATCH_BUDGET,
  BREAKPOINTS,
  SCREENSHOT_SELECTOR,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_WAIT_MS,
} from "./constants.js";

/** Epsilon for rollback: if new score is worse by more than this, rollback */
const ROLLBACK_EPSILON = 0.005;
/** Minimum match-score increase to count as real improvement (noise guard). */
const IMPROVEMENT_EPSILON = 0.0005;

/**
 * Returns true when current score indicates we should rollback (regression).
 * Used by loop and by tests to assert rollback is enforced.
 */
export function shouldRollbackRegression(lastMatchScore, currentMatchScore, epsilon = ROLLBACK_EPSILON) {
  return (
    Number.isFinite(lastMatchScore) &&
    Number.isFinite(currentMatchScore) &&
    currentMatchScore < lastMatchScore - epsilon
  );
}

const QA_DIR = path.join(PREVIEW_DIR, "qa");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p, fallback = null) {
  if (!p || !fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function readCurrentArtifactHtml(slug) {
  const safe = String(slug || "").trim();
  if (!safe) return "";
  const outDir = path.join(ROOT, "..", "fixtures.out", safe);
  const order = ["improve", "codeit", "generate"];
  for (const stage of order) {
    const file = path.join(outDir, `artifact.${stage}.json`);
    if (!fs.existsSync(file)) continue;
    const j = readJson(file, null);
    const html = String(j?.html || "");
    if (html) return html;
  }
  return "";
}

function baseSlugFrom(slug) {
  const s = String(slug || "").trim();
  if (!s) return "";
  return s.replace(/(_|-|@)(desktop|tablet|mobile)$/i, "").trim();
}

function hasAnyFigmaInDir(dir) {
  if (!fs.existsSync(dir)) return false;
  return ["figma.png", "figma.desktop.png", "figma.mobile.png", "figma.tablet.png"].some((f) =>
    fs.existsSync(path.join(dir, f))
  );
}

function resolveOutDir(slug) {
  const base = baseSlugFrom(slug);
  const dirRaw = path.join(VDIFF_DIR, slug);
  const dirBase = base ? path.join(VDIFF_DIR, base) : dirRaw;
  if (base && hasAnyFigmaInDir(dirBase)) return { outDir: dirBase, publicSlug: base };
  return { outDir: dirRaw, publicSlug: slug };
}

/**
 * Run one compare cycle (multi viewport), then capture layout per bucket and run diff/cluster.
 */
async function runCompareAndCapture({ slug, port, vdiffOutDir, qaOutDir, fetchCompare, log = () => {} }) {
  const MAX_COMPARE_ATTEMPTS = 3;
  const RETRY_BASE_DELAY_MS = 300;
  let compareRes = null;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_COMPARE_ATTEMPTS; attempt += 1) {
    try {
      compareRes = await fetchCompare(slug);
      if (compareRes?.ok) break;
      lastError = String(compareRes?.error || "Compare failed");
    } catch (err) {
      lastError = String(err?.message || err || "Compare failed");
    }
    if (attempt < MAX_COMPARE_ATTEMPTS) {
      log("Compare attempt failed; retrying", { attempt, max: MAX_COMPARE_ATTEMPTS, error: lastError });
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  if (!compareRes?.ok) {
    return { ok: false, error: lastError || compareRes?.error || "Compare failed" };
  }

  const scores = {};
  const layouts = {};
  const outputRects = {};
  const offenderRects = {};

  const deps = await loadCompareDeps();
  const { PNG, pixelmatch } = deps;

  for (const bucket of ["desktop", "tablet", "mobile"]) {
    const scorePath = path.join(vdiffOutDir, `score.${bucket}.json`);
    scores[bucket] = readJson(scorePath, {});
    const viewport = BREAKPOINTS[bucket];
    const layout = await captureLayoutJson({
      chromium: deps.chromium,
      slug,
      port,
      outDir: vdiffOutDir,
      viewport,
      waitMs: 80,
    });
    layouts[bucket] = layout;
    const rects = {};
    for (const el of layout || []) {
      const dataKey = String(el?.dataKey || "").trim();
      const nodeId = String(el?.nodeId || "").trim();
      if (!dataKey && !nodeId) continue;
      const b = el?.bbox;
      if (!b) continue;
      const box = { x: b.x, y: b.y, w: b.w, h: b.h };
      // Keep both aliases so rule lookups work regardless of keying source
      // (DOM data-key path vs Figma node-id).
      if (dataKey) rects[dataKey] = box;
      if (nodeId) rects[nodeId] = box;
    }
    outputRects[bucket] = rects;

    const diffPath = path.join(vdiffOutDir, `diff.${bucket}.png`);
    if (fs.existsSync(diffPath)) {
      offenderRects[bucket] = clusterOffendersFromLayout(diffPath, layout, { minBboxArea: 200 });
    } else {
      offenderRects[bucket] = [];
    }
  }

  ensureDir(qaOutDir);
  for (const bucket of ["desktop", "tablet", "mobile"]) {
    const renderSrc = path.join(vdiffOutDir, `render.${bucket}.png`);
    const diffSrc = path.join(vdiffOutDir, `diff.${bucket}.png`);
    if (fs.existsSync(renderSrc)) fs.copyFileSync(renderSrc, path.join(qaOutDir, `${bucket}.png`));
    if (fs.existsSync(diffSrc)) fs.copyFileSync(diffSrc, path.join(qaOutDir, `diff-${bucket}.png`));
    const rectsPath = path.join(qaOutDir, `rects-${bucket}.json`);
    const rects = outputRects[bucket] || {};
    fs.writeFileSync(rectsPath, JSON.stringify(rects, null, 2), "utf8");
  }

  const reportPath = path.join(qaOutDir, "report.json");
  const report = {
    at: new Date().toISOString(),
    slug,
    scores: Object.fromEntries(
      Object.entries(scores).map(([b, s]) => [b, { score: 1 - Number(s?.diffRatio ?? 0), diffRatio: s?.diffRatio }])
    ),
    offenders: offenderRects,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  return {
    ok: true,
    scores,
    layouts,
    outputRects,
    offenderRects,
    reportPath,
  };
}

/**
 * Run the Visual QA + Auto-Fix loop.
 * @param {{ slug: string, port: number, serverUrl?: string, fetchCompare: (slug: string) => Promise<{ ok: boolean, error?: string }>, passDiffRatio?: number, maxIterations?: number, patchBudget?: number }} options
 */
export async function runVisualQALoop(options) {
  const {
    slug: slugRaw,
    port = 5173,
    fetchCompare,
    passDiffRatio = DEFAULT_PASS_DIFF_RATIO,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    patchBudget = DEFAULT_PATCH_BUDGET,
    reportOnly = false,
  } = options;

  const slug = String(slugRaw || "").trim();
  if (!slug) return { ok: false, error: "Missing slug" };
  if (typeof fetchCompare !== "function") return { ok: false, error: "Missing fetchCompare" };

  const log = (msg, ...args) => {
    try { console.log("[visual-qa]", msg, ...args); } catch {}
  };

  const { outDir: vdiffOutDir } = resolveOutDir(slug);

  if (!hasAnyFigmaInDir(vdiffOutDir)) {
    log("Abort: no design reference in", vdiffOutDir);
    return { ok: false, error: `No design reference (figma.*.png) in ${vdiffOutDir}. Run compare once or add baseline images.` };
  }

  log("Build and preview…");
  const build = await runBuildAndPreview({ slug });
  if (!build.ok) {
    return { ok: false, error: build.error || "Build failed", stage: build.stage };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const qaOutDir = path.join(QA_DIR, slug, timestamp);
  ensureDir(qaOutDir);

  const staged = readStage(slug);
  const ast = staged?.ast || null;
  if (ast) {
    writeExpectedRects(ast, qaOutDir);
  }
  const expectedData = readJson(path.join(qaOutDir, "expected-rects.json"), {});
  const expectedRects = expectedData.rects || {};
  const parentRects = expectedData.parentRects || {};

  let patchesApplied = [];
  let totalPatchCount = 0;
  // Start each QA run from a clean baseline so stale/bad historical patches
  // (for example old media width hacks) do not poison the next optimization run.
  let previousPatchesMap = {};
  let currentPatchesMap = {};
  if (!reportOnly) {
    writePatchesFile(vdiffOutDir, currentPatchesMap);
  }
  let lastWorstScore = 0;
  let bestMatchScore = 0;
  let itersWithoutImprovement = 0;
  const MAX_ITERS_WITHOUT_IMPROVEMENT = 2;
  let iter = 0;
  let stoppedReason = "";
  let lastError = "";
  let lastExhaustion = null;

  while (iter < maxIterations && totalPatchCount < patchBudget) {
    iter += 1;
    log("Iteration", iter, "…");
    const cycle = await runCompareAndCapture({
      slug,
      port,
      vdiffOutDir,
      qaOutDir,
      fetchCompare,
      log,
    });

    if (!cycle.ok) {
      stoppedReason = "compare-failed";
      lastError = String(cycle?.error || "Compare failed");
      log("Compare failed:", lastError);
      break;
    }

    const { scores, layouts, outputRects, offenderRects } = cycle;
    const worstScore = Math.min(
      Number(scores.desktop?.diffRatio ?? 1),
      Number(scores.tablet?.diffRatio ?? 1),
      Number(scores.mobile?.diffRatio ?? 1)
    );
    const worstScoreAsMatch = 1 - worstScore;

    if (worstScore <= passDiffRatio) {
      log("Pass threshold reached");
      stoppedReason = "pass";
      break;
    }

    // previousPatchesMap = state before we applied last iteration's patches; rollback removes that batch
    if (iter > 1 && shouldRollbackRegression(lastWorstScore, worstScoreAsMatch, ROLLBACK_EPSILON)) {
      rollbackPatchesFile(vdiffOutDir, previousPatchesMap);
      currentPatchesMap = { ...previousPatchesMap };
      const rollbackIter = iter - 1;
      const removed = patchesApplied.filter((p) => p.iter === rollbackIter);
      patchesApplied = patchesApplied.filter((p) => p.iter !== rollbackIter);
      totalPatchCount -= removed.length;
      stoppedReason = "rollback-regression";
      break;
    }
    if (worstScoreAsMatch > bestMatchScore + IMPROVEMENT_EPSILON) {
      bestMatchScore = worstScoreAsMatch;
      itersWithoutImprovement = 0;
    } else if (iter > 1) {
      itersWithoutImprovement += 1;
      if (itersWithoutImprovement >= MAX_ITERS_WITHOUT_IMPROVEMENT) {
        stoppedReason = "no-improvement";
        break;
      }
    }
    lastWorstScore = worstScoreAsMatch;
    // Save state before we apply this iteration's patches so next iter can rollback this batch
    const patchesMapBeforeThisIter = { ...currentPatchesMap };

    const htmlForRules = readCurrentArtifactHtml(slug);
    const issues = runConstraintEngine({
      report: { offenders: offenderRects },
      rectsByBp: outputRects,
      ast,
      html: htmlForRules,
    });

    const iterReportPath = path.join(qaOutDir, `iter-${iter - 1}-report.json`);
    fs.writeFileSync(
      iterReportPath,
      JSON.stringify(
        {
          iter,
          slug,
          scores: Object.fromEntries(
            Object.entries(scores).map(([b, s]) => [b, { score: 1 - Number(s?.diffRatio ?? 0), diffRatio: s?.diffRatio }])
          ),
          offenders: offenderRects,
          issues,
        },
        null,
        2
      ),
      "utf8"
    );

    if (!issues.length) {
      stoppedReason = "no-issues";
      break;
    }
    if (reportOnly) {
      stoppedReason = "report-only";
      break;
    }

    let appliedThisIter = 0;
    let attemptedPatchCount = 0;
    let validPatchCount = 0;
    let resolvedNodeCount = 0;
    let mergeablePatchCount = 0;
    // Try ranked issues/candidates until we find a patch batch that is applicable.
    issueLoop: for (const issue of issues) {
      const bucket = String(issue?.bp || "desktop").toLowerCase();
      const layoutForApply = layouts[bucket] || [];
      const candidates = Array.isArray(issue?.candidates) ? issue.candidates : [];
      for (const candidate of candidates) {
        const candidatePatches = Array.isArray(candidate?.patches) ? candidate.patches : [];
        let appliedThisCandidate = 0;
        for (const p of candidatePatches) {
          if (totalPatchCount >= patchBudget) break issueLoop;
          attemptedPatchCount += 1;
          if (!validatePatchShape(p)) continue;
          validPatchCount += 1;
          const nodeId = resolveToNodeId(layoutForApply, p.targetKey);
          if (!nodeId) continue;
          resolvedNodeCount += 1;
          const patch = createPatch({ targetKey: p.targetKey, op: p.op, classes: p.classes });
          if (!patch.classes?.length) continue;
          const prevEntry = JSON.stringify(currentPatchesMap[nodeId] || {});
          const nextMap = mergePatchIntoMap(currentPatchesMap, patch, nodeId);
          const nextEntry = JSON.stringify(nextMap[nodeId] || {});
          // Skip duplicate/no-op patch merges so we don't burn budget on unchanged ops.
          if (prevEntry === nextEntry) continue;
          mergeablePatchCount += 1;
          currentPatchesMap = nextMap;
          writePatchesFile(vdiffOutDir, currentPatchesMap);
          patchesApplied.push({ iter, issueType: issue?.issueType, targetKey: p.targetKey, patch });
          appliedThisIter += 1;
          appliedThisCandidate += 1;
          totalPatchCount += 1;
        }
        // Commit one applicable candidate batch per iteration, then re-render.
        if (appliedThisCandidate > 0) break issueLoop;
      }
    }

    if (appliedThisIter === 0) {
      lastExhaustion = {
        attemptedPatchCount,
        validPatchCount,
        resolvedNodeCount,
        mergeablePatchCount,
      };
      stoppedReason = attemptedPatchCount > 0 ? "exhausted-candidates" : "no-applicable-fix";
      break;
    }
    previousPatchesMap = patchesMapBeforeThisIter;
  }

  if (iter >= maxIterations && !stoppedReason) stoppedReason = "max-iters";
  if (totalPatchCount >= patchBudget && !stoppedReason) stoppedReason = "patch-budget";

  log("Finished:", stoppedReason, "iterations:", iter, "patches:", totalPatchCount);

  const finalReportPath = path.join(qaOutDir, "report.json");
  const finalReport = readJson(finalReportPath, {});
  const patchesPath = path.join(qaOutDir, "patches.json");
  fs.writeFileSync(patchesPath, JSON.stringify(patchesApplied, null, 2), "utf8");

  const summary = {
    ok: stoppedReason === "pass",
    slug,
    stoppedReason,
    error: lastError || undefined,
    iterations: iter,
    totalPatchCount,
    patchesApplied,
    exhausted: lastExhaustion || undefined,
    reportPath: finalReportPath,
    patchesPath,
    qaOutDir,
  };

  const reportWithSummary = { ...finalReport, summary };
  fs.writeFileSync(finalReportPath, JSON.stringify(reportWithSummary, null, 2), "utf8");

  return summary;
}
