"use strict";

/**
 * Produce a unified diff (before -> after). Truncate if more than maxLines in output.
 * Uses simple line-by-line LCS-style comparison.
 * @param {string} before
 * @param {string} after
 * @param {{ maxLines?: number }} [opts]
 * @returns {{ diff: string, truncated: boolean, totalChanges: number }}
 */
function unifiedDiff(before, after, opts = {}) {
  const maxLines = opts.maxLines ?? 200;
  const a = String(before || "").split(/\r?\n/);
  const b = String(after || "").split(/\r?\n/);

  const result = [];
  let totalChanges = 0;
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push(" " + a[i]);
      i += 1;
      j += 1;
      continue;
    }
    if (i < a.length) {
      result.push("-" + a[i]);
      totalChanges += 1;
      i += 1;
    }
    if (j < b.length) {
      result.push("+" + b[j]);
      totalChanges += 1;
      j += 1;
    }
  }

  const truncated = result.length > maxLines;
  const lines = truncated ? result.slice(0, maxLines) : result;
  const diffText =
    lines.join("\n") +
    (truncated ? `\n… ${result.length - maxLines} more lines (${totalChanges} changes)` : "");

  return {
    diff: diffText,
    truncated,
    totalChanges,
  };
}

module.exports = { unifiedDiff };
