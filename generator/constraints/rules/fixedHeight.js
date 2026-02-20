// generator/constraints/rules/fixedHeight.js
import {
  classTokens,
  findFixedHeightTokens,
  isMediaNode,
  makeCandidate,
  makeIssue,
  makePatch,
  num,
  resolveNodeInfo,
} from "../utils.js";

export const RULE_FIXED_HEIGHT_WRAPPER = "FIXED_HEIGHT_WRAPPER";

export function detectFixedHeightIssues({
  bp,
  offenders = [],
  rects = {},
  expected = {},
  nodeIndex = null,
}) {
  const out = [];
  const parentByKey = expected?.parentByKey || {};
  const childrenByKey = expected?.childrenByKey || {};

  const keys = new Set();
  for (const off of offenders || []) {
    const k = String(off?.dataKey || off?.nodeId || "").trim();
    if (k) keys.add(k);
  }
  for (const k of Object.keys(rects || {})) keys.add(k);

  for (const key of keys) {
    const info = resolveNodeInfo(nodeIndex, key);
    if (!info || isMediaNode(info)) continue;
    const tokens = classTokens(info.className);
    const hTokens = findFixedHeightTokens(tokens);
    if (!hTokens.length) continue;

    const childKeys = Array.isArray(childrenByKey[key]) ? childrenByKey[key] : [];
    if (!childKeys.length) continue;
    const wrapperRect = rects[key];
    if (!wrapperRect) continue;

    let clipping = false;
    for (const ck of childKeys) {
      const cr = rects[ck];
      if (!cr) continue;
      const childBottom = num(cr.y) + num(cr.h);
      const wrapperBottom = num(wrapperRect.y) + num(wrapperRect.h);
      if (childBottom > wrapperBottom + 2) {
        clipping = true;
        break;
      }
    }

    // Also consider repeated offender overlap on wrapper as clipping signal.
    if (!clipping) {
      const severe = offenders.find((o) => String(o?.dataKey || o?.nodeId || "").trim() === key && num(o?.severity) >= 0.6);
      clipping = Boolean(severe);
    }
    if (!clipping) continue;

    const confidence = 0.78;
    out.push(
      makeIssue({
        issueType: RULE_FIXED_HEIGHT_WRAPPER,
        bp,
        confidence,
        targetKey: key,
        candidates: [makeCandidate(0.8, [makePatch(key, "classRemove", hTokens)])],
        evidence: {
          expectedRect: expected?.rects?.[key] || null,
          rect: wrapperRect,
          delta: {
            fixedHeightTokens: hTokens,
            clipping,
            parentKey: String(parentByKey[key] || ""),
          },
        },
      })
    );
  }

  return out;
}

