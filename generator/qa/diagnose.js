// generator/qa/diagnose.js — Rule-based mismatch diagnostics from offenders, output rects, expected rects

/** Issue types (v1) */
export const ISSUE_TYPES = {
  WIDTH_MISMATCH_FULL: "WIDTH_MISMATCH_FULL",
  STACKING_MISMATCH: "STACKING_MISMATCH",
  TYPOGRAPHY_MISMATCH: "TYPOGRAPHY_MISMATCH",
  IMAGE_FIT_MISMATCH: "IMAGE_FIT_MISMATCH",
};

/** Minimum ratio of element width to parent width to consider "expected full width" */
const FULL_WIDTH_RATIO = 0.92;
/** Output width much smaller than expected when ratio < this */
const WIDTH_MISMATCH_RATIO = 0.85;

/**
 * Diagnose issues from offender rects, output rects, and expected rects.
 * @param {{
 *   breakpoint: string,
 *   offenderRects: Array<{ x, y, w, h, area, severity, nodeId?, dataKey? }>,
 *   outputRects: Record<string, { x, y, w, h }>,
 *   expectedRects: Record<string, { x, y, w, h }>,
 *   parentRects?: Record<string, { x, y, w, h }>,
 *   layout?: Array<{ nodeId, dataKey, bbox, tag, className }>,
 * }} inputs
 * @returns {Array<{ issueType, breakpoint, targetKey, parentKey?, evidence, suggestedFixes, confidence }>}
 */
export function diagnose(inputs) {
  const {
    breakpoint = "desktop",
    offenderRects = [],
    outputRects = {},
    expectedRects = {},
    parentRects = {},
    layout = [],
  } = inputs;

  const issues = [];

  function isButtonOrActionLikeEl(el) {
    const tag = String(el?.tag ?? "").toLowerCase();
    const className = String(el?.className ?? "").toLowerCase();
    return (
      tag === "button" ||
      tag === "a" ||
      tag === "input" ||
      /btn|cta|button/.test(className)
    );
  }

  function isMediaLikeEl(el) {
    const tag = String(el?.tag ?? "").toLowerCase();
    const className = String(el?.className ?? "").toLowerCase();
    return (
      tag === "img" ||
      tag === "picture" ||
      tag === "video" ||
      /object-cover|object-contain|bg-cover|bg-no-repeat/.test(className)
    );
  }

  // Resolve key -> nodeId for layout (dataKey or nodeId)
  const keyToNodeId = new Map();
  const keyToLayoutEl = new Map();
  const idToLayoutEl = new Map();
  for (const el of layout) {
    const dk = String(el?.dataKey ?? "").trim();
    const id = String(el?.nodeId ?? "").trim();
    const k = dk || id;
    if (k) keyToNodeId.set(k, String(el?.nodeId ?? ""));
    if (dk) keyToLayoutEl.set(dk, el);
    if (id) idToLayoutEl.set(id, el);
  }

  function resolveLayoutEl(targetKey, nodeId) {
    return keyToLayoutEl.get(String(targetKey || "").trim()) || idToLayoutEl.get(String(nodeId || "").trim()) || null;
  }

  /** Resolve expected/parent lookup key: layout uses data-key (path) or nodeId; expected may be keyed by nodeId. */
  function resolveExpectedKey(targetKey, nodeId) {
    if (expectedRects[targetKey]) return targetKey;
    if (nodeId && expectedRects[nodeId]) return nodeId;
    return null;
  }

  // WIDTH_MISMATCH_FULL: expected rect width ≈ parent width but output rect is much smaller
  for (const offender of offenderRects) {
    const targetKey = offender.dataKey || offender.nodeId || "";
    if (!targetKey) continue;

    const outRect = outputRects[targetKey] || (offender.nodeId ? outputRects[offender.nodeId] : null);
    const expectedKey = resolveExpectedKey(targetKey, offender.nodeId);
    const expRect = expectedKey ? expectedRects[expectedKey] : null;
    const parentRect = expectedKey ? parentRects[expectedKey] : null;

    if (!outRect || !expRect || !parentRect) continue;
    const layoutEl = resolveLayoutEl(targetKey, offender.nodeId);
    if (isMediaLikeEl(layoutEl)) continue;
    // Width-fill fixes are most reliable for actionable controls (button/CTA/link).
    if (!isButtonOrActionLikeEl(layoutEl)) continue;
    const expW = Number(expRect.w ?? 0);
    const parentW = Number(parentRect.w ?? 0);
    const outW = Number(outRect.w ?? 0);
    if (parentW <= 0 || expW <= 0) continue;

    const expVsParent = expW / parentW;
    const outVsParent = outW / parentW;
    const outVsExp = parentW > 0 ? outW / expW : 0;

    // Design: element is effectively full-width (e.g. button fills container)
    if (expVsParent >= FULL_WIDTH_RATIO && outVsParent < WIDTH_MISMATCH_RATIO) {
      const confidence = Math.min(0.95, Math.max(0.75, (expVsParent - outVsParent) * 2));
      issues.push({
        issueType: ISSUE_TYPES.WIDTH_MISMATCH_FULL,
        breakpoint,
        targetKey,
        parentKey: null,
        evidence: {
          expectedWidth: expW,
          parentWidth: parentW,
          outputWidth: outW,
          expVsParent,
          outVsParent,
          outVsExp,
          offenderOverlap: offender.severity,
        },
        suggestedFixes: [
          { op: "classAdd", classes: ["w-full"], breakpointOnly: breakpoint },
          { op: "classAdd", classes: ["block", "w-full"], breakpointOnly: breakpoint },
          { op: "classRemove", classes: ["w-fit", "inline-flex", "self-start"], breakpointOnly: breakpoint },
        ],
        confidence,
      });
    }
  }

  // Optional: detect button/CTA by tag or class and apply same rule using only output vs parent
  for (const el of layout) {
    const targetKey = el?.dataKey || el?.nodeId || "";
    if (!targetKey) continue;
    const isButtonOrLink = isButtonOrActionLikeEl(el);
    if (!isButtonOrLink) continue;

    const outRect = outputRects[targetKey];
    const parentRect = parentRects[targetKey] || (el?.nodeId ? parentRects[el.nodeId] : null);
    if (!outRect || !parentRect) continue;

    const parentW = Number(parentRect.w ?? 0);
    const outW = Number(outRect.w ?? 0);
    if (parentW <= 0) continue;
    const outVsParent = outW / parentW;

    const offender = offenderRects.find((o) => (o.dataKey || o.nodeId) === targetKey);
    if (outVsParent < WIDTH_MISMATCH_RATIO && (offender || outW < parentW * 0.9)) {
      const alreadyReported = issues.some(
        (i) => i.issueType === ISSUE_TYPES.WIDTH_MISMATCH_FULL && i.targetKey === targetKey
      );
      if (!alreadyReported) {
        issues.push({
          issueType: ISSUE_TYPES.WIDTH_MISMATCH_FULL,
          breakpoint,
          targetKey,
          parentKey: null,
          evidence: {
            outputWidth: outW,
            parentWidth: parentW,
            outVsParent,
            inferredFullWidth: true,
          },
          suggestedFixes: [
            { op: "classAdd", classes: ["w-full"], breakpointOnly: breakpoint },
            { op: "classAdd", classes: ["block", "w-full"], breakpointOnly: breakpoint },
          ],
          confidence: 0.85,
        });
      }
    }
  }

  // STACKING_MISMATCH / TYPOGRAPHY_MISMATCH / IMAGE_FIT_MISMATCH: placeholders for v1
  // Can be extended with layout flex direction vs expected, text bbox clusters, image object-fit.

  return issues;
}
