import { test } from "node:test";
import assert from "node:assert/strict";
import { detectStackingIssues, RULE_STACKING_MISMATCH } from "../rules/stacking.js";

test("stacking detects expected columns rendered as rows", () => {
  const expected = {
    rects: {
      parent: { x: 0, y: 0, w: 800, h: 300 },
      left: { x: 0, y: 0, w: 380, h: 260 },
      right: { x: 420, y: 0, w: 380, h: 260 },
    },
    childrenByKey: { parent: ["left", "right"] },
  };
  const rects = {
    parent: { x: 0, y: 0, w: 800, h: 520 },
    left: { x: 0, y: 0, w: 760, h: 250 },
    right: { x: 4, y: 270, w: 760, h: 250 },
  };
  const issues = detectStackingIssues({ bp: "mobile", rects, expected, nodeIndex: null });
  assert.ok(issues.length > 0);
  assert.equal(issues[0].issueType, RULE_STACKING_MISMATCH);
  assert.equal(issues[0].targetKey, "parent");
});

