// generator/constraints/rules/stacking.js
import { classTokens, makeCandidate, makeIssue, makePatch, num, resolveNodeInfo } from "../utils.js";

export const RULE_STACKING_MISMATCH = "STACKING_MISMATCH";

function overlapY(a, b) {
  const a1 = num(a?.y), a2 = a1 + num(a?.h);
  const b1 = num(b?.y), b2 = b1 + num(b?.h);
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

export function detectStackingIssues({
  bp,
  rects = {},
  expected = {},
  nodeIndex = null,
}) {
  const out = [];
  const childrenByKey = expected?.childrenByKey || {};
  const expectedRects = expected?.rects || {};

  for (const [parentKey, kids] of Object.entries(childrenByKey)) {
    if (!Array.isArray(kids) || kids.length < 2) continue;
    const k1 = String(kids[0] || "").trim();
    const k2 = String(kids[1] || "").trim();
    if (!k1 || !k2) continue;

    const e1 = expectedRects[k1];
    const e2 = expectedRects[k2];
    const r1 = rects[k1];
    const r2 = rects[k2];
    if (!e1 || !e2 || !r1 || !r2) continue;

    const expectedColumns = overlapY(e1, e2) > Math.min(num(e1.h), num(e2.h)) * 0.35 && Math.abs(num(e1.x) - num(e2.x)) > 24;
    const outputStacked = Math.abs(num(r1.x) - num(r2.x)) < 20 && Math.abs(num(r1.y) - num(r2.y)) > 24;
    if (!expectedColumns || !outputStacked) continue;

    const parentInfo = resolveNodeInfo(nodeIndex, parentKey);
    const pTokens = classTokens(parentInfo?.className || "");
    const hasFlex = pTokens.includes("flex");
    const c1 = makeCandidate(0.82, [makePatch(parentKey, "classAdd", hasFlex ? ["md:flex-row"] : ["md:grid", "md:grid-cols-2"])]);
    const c2 = makeCandidate(0.74, [makePatch(parentKey, "classAdd", ["md:grid", "md:grid-cols-2"])]);
    const c3 = makeCandidate(0.69, [
      makePatch(parentKey, "classAdd", ["md:flex-row"]),
      makePatch(k1, "classAdd", ["md:flex-1"]),
    ]);

    out.push(
      makeIssue({
        issueType: RULE_STACKING_MISMATCH,
        bp,
        confidence: 0.82,
        targetKey: parentKey,
        candidates: [c1, c2, c3],
        evidence: {
          expectedRect: expectedRects[parentKey] || null,
          rect: rects[parentKey] || null,
          delta: {
            expectedColumns: true,
            outputStacked: true,
            xDelta: Math.abs(num(r1.x) - num(r2.x)),
            yDelta: Math.abs(num(r1.y) - num(r2.y)),
          },
        },
      })
    );
  }

  return out;
}

