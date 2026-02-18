"use strict";

const { audit } = require("./audit");
const { fix } = require("./fix");
const { unifiedDiff } = require("./diff");

/**
 * Run QA Gate: audit + deterministic fix loop until convergence (bounded).
 * @param {string} html
 * @param {{ diffMaxLines?: number, artifact?: object, maxPasses?: number, cleanMetadata?: boolean }} [opts]
 * @returns {{ reportBefore, reportAfter, fixedHtml, appliedFixes, currentHtml, diff, remainingErrors, remainingFatal, byRule }}
 */
function runQAGate(html, opts = {}) {
  const currentHtml = String(html || "");
  const maxPasses = Math.max(1, Number(opts.maxPasses || 3));
  const reportBefore = audit(currentHtml);

  let workingHtml = currentHtml;
  let workingReport = reportBefore;
  const appliedFixes = [];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const out = fix(workingHtml, workingReport.issues || [], {
      artifact: opts.artifact,
      cleanMetadata: Boolean(opts.cleanMetadata),
    });
    const nextHtml = String(out?.fixedHtml || "");
    const passFixes = Array.isArray(out?.appliedFixes) ? out.appliedFixes : [];
    if (passFixes.length) appliedFixes.push(...passFixes);
    if (nextHtml === workingHtml || passFixes.length === 0) break;

    workingHtml = nextHtml;
    workingReport = audit(workingHtml);
  }

  const fixedHtml = workingHtml;
  const reportAfter = audit(fixedHtml);
  const { diff, truncated: diffTruncated, totalChanges } = unifiedDiff(
    currentHtml,
    fixedHtml,
    { maxLines: opts.diffMaxLines ?? 500 }
  );

  const remainingErrors = (reportAfter.summary && reportAfter.summary.error) || 0;
  const remainingFatal = (reportAfter.issues || []).filter((i) => i && i.fatal).length;

  return {
    reportBefore,
    reportAfter,
    fixedHtml,
    appliedFixes,
    currentHtml,
    diff,
    diffTruncated,
    totalChanges,
    remainingErrors,
    remainingFatal,
    byRule: reportAfter.byRule || {},
  };
}

function runQAFixLoop(html, opts = {}) {
  const currentHtml = String(html || "");
  const maxIterations = Math.max(1, Number(opts.maxIterations || 10));
  const maxFixesPerIteration = Math.max(1, Number(opts.maxFixesPerIteration || 200));
  let workingHtml = currentHtml;
  const iterations = [];
  const allAppliedFixes = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const previousHtml = workingHtml;
    const reportBefore = audit(workingHtml);
    const issuesBeforeCount = Array.isArray(reportBefore?.issues) ? reportBefore.issues.length : 0;
    if (issuesBeforeCount === 0) {
      iterations.push({
        iteration,
        issuesBefore: 0,
        issuesAfter: 0,
        reportBefore,
        reportAfter: reportBefore,
        appliedFixes: [],
        stopped: "zero-issues",
      });
      break;
    }

    const out = fix(workingHtml, reportBefore.issues || [], {
      artifact: opts.artifact,
      cleanMetadata: false,
    });
    const rawFixes = Array.isArray(out?.appliedFixes) ? out.appliedFixes : [];
    const appliedFixes = rawFixes.slice(0, maxFixesPerIteration);
    if (appliedFixes.length) allAppliedFixes.push(...appliedFixes);
    const nextHtml = String(out?.fixedHtml || workingHtml);
    const reportAfter = audit(nextHtml);
    const issuesAfterCount = Array.isArray(reportAfter?.issues) ? reportAfter.issues.length : 0;
    iterations.push({
      iteration,
      issuesBefore: issuesBeforeCount,
      issuesAfter: issuesAfterCount,
      reportBefore,
      reportAfter,
      appliedFixes,
      stopped: null,
    });

    // Always advance the working HTML to this iteration output so reportAfter/fixedHtml
    // reflect the actual post-fix state (including zero-issue convergence).
    workingHtml = nextHtml;

    if (issuesAfterCount === 0) break;
    if (!appliedFixes.length || nextHtml === previousHtml) {
      iterations[iterations.length - 1].stopped = "no-progress";
      break;
    }
  }

  const reportBefore = audit(currentHtml);
  const reportAfter = audit(workingHtml);
  const { diff, truncated: diffTruncated, totalChanges } = unifiedDiff(currentHtml, workingHtml, {
    maxLines: opts.diffMaxLines ?? 500,
  });
  const remainingIssues = Array.isArray(reportAfter?.issues) ? reportAfter.issues.length : 0;
  const hitLimit = remainingIssues > 0 && iterations.length >= maxIterations;

  return {
    reportBefore,
    reportAfter,
    fixedHtml: workingHtml,
    currentHtml,
    appliedFixes: allAppliedFixes,
    iterations,
    iterationsCount: iterations.length,
    hitLimit,
    remainingIssues,
    remainingErrors: (reportAfter.summary && reportAfter.summary.error) || 0,
    remainingFatal: (reportAfter.issues || []).filter((i) => i && i.fatal).length,
    byRule: reportAfter.byRule || {},
    diff,
    diffTruncated,
    totalChanges,
  };
}

module.exports = { audit, fix, runQAGate, runQAFixLoop };
