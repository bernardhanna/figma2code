import containerContract from "./container.contract.js";
import sizingContract from "./sizing.contract.js";
import imageFitContract from "./imageFit.contract.js";
import ctaContract from "./cta.contract.js";

export const CONTRACTS = [containerContract, sizingContract, imageFitContract, ctaContract];

function sortContracts(contracts) {
  return [...contracts].sort((a, b) => {
    const orderA = Number.isFinite(a?.order) ? a.order : 0;
    const orderB = Number.isFinite(b?.order) ? b.order : 0;
    if (orderA !== orderB) return orderA - orderB;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

export function runContracts(html, ctx = {}) {
  const ordered = sortContracts(CONTRACTS);
  let currentHtml = String(html || "");
  const report = {
    contracts: [],
    totals: { changedNodes: 0, notes: 0 },
  };

  for (const contract of ordered) {
    const result = contract.apply(currentHtml, ctx) || {};
    const changedNodes = Number(result.changedNodes || 0);
    const notes = Array.isArray(result.notes) ? result.notes : [];
    currentHtml = typeof result.html === "string" ? result.html : currentHtml;
    report.contracts.push({
      name: contract.name,
      changedNodes,
      notes,
    });
    report.totals.changedNodes += changedNodes;
    report.totals.notes += notes.length;
  }

  return { html: currentHtml, report };
}
