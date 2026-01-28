import heightsContract from "./heights.contract.js";
import gridWidthsContract from "./gridWidths.contract.js";
import flexWidthsContract from "./flexWidths.contract.js";
import sectionPaddingContract from "./sectionPadding.contract.js";
import widthIntentContract from "./widthIntent.contract.js";
import ctaContract from "./cta.contract.js";
import underlineBarContract from "./underlineBar.contract.js";
import widthCleanupContract from "./widthCleanup.contract.js";
import widthIntentSanityContract from "./widthIntentSanity.contract.js";
import containerMirrorTextWidthContract from "./containerMirrorTextWidth.contract.js";
import maxWFullDedupeContract from "./maxWFullDedupe.contract.js";
import widthHygieneContract from "./widthHygiene.contract.js";
import gridColumnWidthCleanupContract from "./gridColumnWidthCleanup.contract.js";
import textSanityContract from "./textSanity.contract.js";
import semanticRestoreWidthCleanupContract from "./semanticRestoreWidthCleanup.contract.js";
import responsiveDuplicateCleanupContract from "./responsiveDuplicateCleanup.contract.js";
import bgPositionCleanupContract from "./bgPositionCleanup.contract.js";
import widthNoiseContract from "./widthNoise.contract.js";

const DEFAULT_CONTRACTS = [
  heightsContract,
  gridWidthsContract,
  flexWidthsContract,
  sectionPaddingContract,
  widthIntentContract,
  ctaContract,
  underlineBarContract,
  gridColumnWidthCleanupContract,
  responsiveDuplicateCleanupContract,
  bgPositionCleanupContract,
  widthNoiseContract,
  widthIntentSanityContract,
  containerMirrorTextWidthContract,
  maxWFullDedupeContract,
  widthCleanupContract,
  widthHygieneContract,
  textSanityContract,
  semanticRestoreWidthCleanupContract,
];

/**
 * Contracts entrypoint.
 *
 * Add a new contract:
 * - Create `*.contract.js` that exports { name, order, apply(html, ctx) }.
 * - Add it to the default list here (order matters).
 * - Keep apply() deterministic and narrowly-scoped.
 */
export function applyContracts({ html, slug, meta, contracts = DEFAULT_CONTRACTS } = {}) {
  const enabled = String(process.env.CONTRACTS || "1").trim() !== "0";
  const report = {
    contracts: [],
    totals: { changedNodes: 0, notes: 0 },
    disabled: !enabled,
  };

  if (!enabled) return { html: String(html || ""), report };

  const ctx = { slug: String(slug || "").trim(), meta: meta || {} };
  let outHtml = String(html || "");

  for (const contract of contracts) {
    const result = contract.apply(outHtml, ctx) || {};
    const notes = Array.isArray(result.notes) ? result.notes : [];
    const changedNodes = Number(result.changedNodes || 0);
    outHtml = typeof result.html === "string" ? result.html : outHtml;
    report.contracts.push({
      name: contract.name,
      changedNodes,
      notes,
    });
    report.totals.changedNodes += changedNodes;
    report.totals.notes += notes.length;
  }

  return { html: outHtml, report };
}
