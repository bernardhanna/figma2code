// generator/constraints/engine.js
import { computeExpectedRects } from "./expected.js";
import { parseHtmlNodeIndex, validateIssueShape } from "./utils.js";
import { detectWidthFullIssues } from "./rules/widthFull.js";
import { detectStackingIssues } from "./rules/stacking.js";
import { detectFixedHeightIssues } from "./rules/fixedHeight.js";
import { detectWidthChainIssues } from "./rules/widthChains.js";

function sortCandidates(candidates) {
  return [...(Array.isArray(candidates) ? candidates : [])].sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
}

function issueRank(issue) {
  const top = Number(sortCandidates(issue?.candidates || [])[0]?.score || 0);
  return Number(issue?.confidence || 0) * 0.6 + top * 0.4;
}

/**
 * Deterministic constraint engine: generates ranked candidate class patches, does not apply.
 * @param {{
 *   report: { offenders?: Record<string, any[]> }|null,
 *   rectsByBp: Record<string, Record<string, {x:number,y:number,w:number,h:number}>>,
 *   ast: any,
 *   html?: string
 * }} input
 */
export function runConstraintEngine(input) {
  const report = input?.report || {};
  const rectsByBp = input?.rectsByBp || {};
  const ast = input?.ast || null;
  const html = String(input?.html || "");

  const expected = computeExpectedRects(ast);
  const nodeIndex = parseHtmlNodeIndex(html);
  const out = [];

  const breakpoints = ["mobile", "tablet", "desktop"];
  for (const bp of breakpoints) {
    const offenders = Array.isArray(report?.offenders?.[bp]) ? report.offenders[bp] : [];
    const rects = rectsByBp?.[bp] || {};

    const issues = [
      ...detectWidthFullIssues({ bp, offenders, rects, expected, nodeIndex }),
      ...detectStackingIssues({ bp, offenders, rects, expected, nodeIndex }),
      ...detectFixedHeightIssues({ bp, offenders, rects, expected, nodeIndex }),
      ...detectWidthChainIssues({ bp, offenders, rects, expected, nodeIndex }),
    ];

    for (const issue of issues) {
      issue.candidates = sortCandidates(issue.candidates);
      if (validateIssueShape(issue)) out.push(issue);
    }
  }

  out.sort((a, b) => issueRank(b) - issueRank(a));
  return out;
}

