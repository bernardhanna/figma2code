"use strict";

/**
 * Progress reporter: discrete events + log output for pipeline stages.
 * Stages call step/succeed/fail and writeSummary; UI can render checklist + final summary.
 */

const PREFIX = { step: "", success: "✓ ", fail: "! " };

function createReporter(logFn = () => {}) {
  const lines = [];
  const events = [];

  const write = (text) => {
    const line = String(text ?? "").trim();
    if (line) {
      lines.push(line);
      if (typeof logFn === "function") logFn(line);
    }
  };

  return {
    /** Emit current step (optional payload). */
    step(label, payload) {
      events.push({ type: "step", label: label || "", payload });
      write(label || "");
    },

    /** Emit step success; append "✓ label". */
    succeed(label, payload) {
      events.push({ type: "success", label: label || "", payload });
      write((PREFIX.success + (label || "")).trim());
    },

    /** Emit step failure; append "! label" or error message. */
    fail(label, err, payload) {
      const msg = err && (err.message || String(err)) ? String(err.message || err) : label;
      events.push({ type: "fail", label: label || "", error: msg, payload });
      write((PREFIX.fail + (label || msg)).trim());
    },

    /** Raw log line (no prefix). */
    log(line) {
      write(line);
    },

    /** Append Improve summary block: offenders, proposed/accepted/rejected, rejection reasons with node ids. */
    writeImproveSummary({
      offendersFound = 0,
      patchesProposed = 0,
      patchesAccepted = 0,
      patchesRejected = 0,
      rejectionReasonGroups = [],
      providerLabel,
      noOffendersMessage,
      noPatchesAcceptedMessage,
    }) {
      write("");
      write("Improve summary:");
      write(`  Offenders found: ${offendersFound}`);
      const label = providerLabel ? `${providerLabel} patches` : "Patches";
      write(
        `  ${label} proposed: ${patchesProposed} / accepted: ${patchesAccepted} / rejected: ${patchesRejected}`
      );
      (rejectionReasonGroups || []).forEach((group) => {
        const list = (group.nodeIds || []).slice(0, 4).join(", ") + ((group.nodeIds || []).length > 4 ? ", …" : "");
        write(`  Rejected (${group.count}): ${String(group.reason || "").trim()}${list ? ` [${list}]` : ""}`);
      });
      if (noOffendersMessage) {
        write(`  ${noOffendersMessage}`);
      } else if (noPatchesAcceptedMessage) {
        write(`  ${noPatchesAcceptedMessage}`);
      }
    },

    /** Append Warnings & Errors, Fixes, bullets, Artifacts written, Score per breakpoint. */
    writeSummary({
      errors = [],
      warnings = [],
      fixCount = 0,
      fixGroups = [],
      formatFixLine = (g) => String(g?.reason || "").trim(),
      artifactsPath = "",
      scorePerBreakpoint = {},
      fallbackScore,
    }) {
      const errCount = Array.isArray(errors) ? errors.length : 0;
      const warnCount = Array.isArray(warnings) ? warnings.length : 0;
      write("");
      write(`Warnings & Errors (Errors: ${errCount}, Warnings: ${warnCount})`);
      write(`Fixes: ${fixCount}`);
      if (Array.isArray(fixGroups) && fixGroups.length) {
        fixGroups.forEach((group) => {
          const line = formatFixLine(group);
          if (line) write(`- ${line}`);
        });
      }
      if (artifactsPath) write(`Artifacts written: ${artifactsPath}`);
      write("Score per breakpoint:");
      const breakpoints = ["mobile", "tablet", "desktop"];
      breakpoints.forEach((bp) => {
        const score = scorePerBreakpoint[bp];
        const value =
          typeof score === "number" ? score.toFixed(4) : (score != null ? String(score) : "—");
        write(`- ${bp}: ${value}`);
      });
      if (fallbackScore != null && typeof fallbackScore === "number") {
        write(`Fallback score: ${fallbackScore}`);
      }
    },

    getLog() {
      return lines.join("\n");
    },

    getEvents() {
      return [...events];
    },
  };
}

module.exports = {
  createReporter,
};
