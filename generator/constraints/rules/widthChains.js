// generator/constraints/rules/widthChains.js
import { classTokens, findFixedWidthTokens, makeCandidate, makeIssue, makePatch, num, resolveNodeInfo } from "../utils.js";

export const RULE_WIDTH_CHAIN_CONFLICT = "WIDTH_CHAIN_CONFLICT";

function immediateParentFromPath(key) {
  const parts = String(key || "").split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export function detectWidthChainIssues({
  bp,
  rects = {},
  expected = {},
  nodeIndex = null,
}) {
  const out = [];
  const expectedRects = expected?.rects || {};

  for (const key of Object.keys(rects || {})) {
    const parentKey = immediateParentFromPath(key);
    if (!parentKey) continue;

    const info = resolveNodeInfo(nodeIndex, key);
    const parentInfo = resolveNodeInfo(nodeIndex, parentKey);
    if (!info || !parentInfo) continue;

    const childW = findFixedWidthTokens(classTokens(info.className));
    const parentW = findFixedWidthTokens(classTokens(parentInfo.className));
    if (!childW.length || !parentW.length) continue;

    const outRect = rects[key];
    const expRect = expectedRects[key];
    if (!outRect || !expRect) continue;
    const ratio = num(outRect.w) / Math.max(1, num(expRect.w));
    if (ratio > 0.9) continue; // conservative: only when clearly constrained

    const confidence = 0.72;
    out.push(
      makeIssue({
        issueType: RULE_WIDTH_CHAIN_CONFLICT,
        bp,
        confidence,
        targetKey: key,
        candidates: [makeCandidate(0.75, [makePatch(key, "classRemove", childW)])],
        evidence: {
          expectedRect: expRect,
          rect: outRect,
          delta: {
            outputVsExpectedWidth: ratio,
            childFixedWidthTokens: childW,
            parentFixedWidthTokens: parentW,
            parentKey,
          },
        },
      })
    );
  }

  return out;
}

