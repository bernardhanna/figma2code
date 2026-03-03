// generator/constraints/rules/widthFull.js
import {
  areaOverlapRatio,
  classTokens,
  hasInlineDisplayClass,
  isInteractiveNode,
  makeCandidate,
  makeIssue,
  makePatch,
  num,
  resolveNodeInfo,
} from "../utils.js";

export const RULE_WIDTH_MISMATCH_FULL = "WIDTH_MISMATCH_FULL";

export function detectWidthFullIssues({
  bp,
  offenders = [],
  rects = {},
  expected = {},
  nodeIndex = null,
}) {
  const out = [];
  const expectedRects = expected?.rects || {};
  const parentRects = expected?.parentRects || {};
  const parentByKey = expected?.parentByKey || {};

  for (const offender of offenders) {
    const targetKey = String(offender?.dataKey || offender?.nodeId || "").trim();
    if (!targetKey) continue;

    const info = resolveNodeInfo(nodeIndex, targetKey);
    if (!isInteractiveNode(info)) continue;

    const rect = rects[targetKey] || rects[String(offender?.nodeId || "").trim()];
    if (!rect) continue;

    const expectedRect = expectedRects[targetKey] || expectedRects[String(offender?.nodeId || "").trim()];
    const expectedParentRect = parentRects[targetKey] || parentRects[String(offender?.nodeId || "").trim()];

    const parentKey = String(parentByKey[targetKey] || "").trim();
    const outputParentRect = rects[parentKey] || null;
    const outParentW = Math.max(num(outputParentRect?.w), num(expectedParentRect?.w));
    const outW = num(rect.w);
    if (outParentW <= 0 || outW <= 0) continue;

    const outCoverage = outW / outParentW;
    const expCoverage =
      num(expectedRect?.w) > 0 && num(expectedParentRect?.w) > 0
        ? num(expectedRect.w) / Math.max(1, num(expectedParentRect.w))
        : 0;
    const overlap = expectedRect ? areaOverlapRatio(rect, expectedRect) : 0;
    const severity = num(offender?.severity, 0.5);

    const shouldBeFull = expCoverage >= 0.9 || overlap >= 0.5 || severity >= 0.7;
    const isNarrow = outCoverage < 0.7;
    if (!shouldBeFull || !isNarrow) continue;

    const tokens = classTokens(info?.className || "");
    const candidates = [];
    const gap = Math.max(0, 1 - outCoverage);
    const baseScore = Math.min(0.95, Math.max(0.35, 0.45 + gap * 0.35 + severity * 0.2));

    candidates.push(makeCandidate(baseScore, [makePatch(targetKey, "classAdd", ["w-full"])]));

    if (hasInlineDisplayClass(tokens) || String(info?.tag || "").toLowerCase() === "a") {
      candidates.push(makeCandidate(baseScore - 0.04, [makePatch(targetKey, "classAdd", ["block", "w-full"])]));
    }

    if (parentKey) {
      candidates.push(makeCandidate(baseScore - 0.08, [makePatch(parentKey, "classAdd", ["w-full"])]));
    }

    const removal = [];
    if (tokens.includes("w-fit")) removal.push("w-fit");
    if (tokens.includes("self-start")) removal.push("self-start");
    if (parentKey) {
      const parentInfo = resolveNodeInfo(nodeIndex, parentKey);
      const pTokens = classTokens(parentInfo?.className || "");
      if (pTokens.includes("w-fit")) removal.push("w-fit");
    }
    if (removal.length) {
      candidates.push(makeCandidate(baseScore - 0.12, [makePatch(targetKey, "classRemove", [...new Set(removal)])]));
    }

    const confidence = Math.min(0.95, Math.max(0.5, baseScore));
    out.push(
      makeIssue({
        issueType: RULE_WIDTH_MISMATCH_FULL,
        bp,
        confidence,
        targetKey,
        candidates,
        evidence: {
          expectedRect: expectedRect || null,
          rect,
          delta: {
            outputCoverage: outCoverage,
            expectedCoverage: expCoverage,
            overlap,
            severity,
          },
        },
      })
    );
  }

  return out;
}

