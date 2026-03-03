// generator/qa/__tests__/diagnose.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { diagnose, ISSUE_TYPES } from "../diagnose.js";

describe("diagnose", () => {
  it("emits WIDTH_MISMATCH_FULL when expected full width but output narrow", () => {
    const outputRects = {
      "instance:button#1": { x: 10, y: 20, w: 100, h: 40 },
      "frame:container#1": { x: 0, y: 0, w: 400, h: 200 },
    };
    const expectedRects = {
      "instance:button#1": { x: 10, y: 20, w: 380, h: 40 },
      "frame:container#1": { x: 0, y: 0, w: 400, h: 200 },
    };
    const parentRects = {
      "instance:button#1": { x: 0, y: 0, w: 400, h: 200 },
    };
    const offenderRects = [
      { dataKey: "instance:button#1", nodeId: "btn1", severity: 0.5, x: 10, y: 20, w: 100, h: 40 },
    ];
    const layout = [
      { nodeId: "btn1", dataKey: "instance:button#1", bbox: { x: 10, y: 20, w: 100, h: 40 }, tag: "button" },
    ];

    const issues = diagnose({
      breakpoint: "desktop",
      offenderRects,
      outputRects,
      expectedRects,
      parentRects,
      layout,
    });

    const widthIssues = issues.filter((i) => i.issueType === ISSUE_TYPES.WIDTH_MISMATCH_FULL);
    assert.ok(widthIssues.length >= 1, "should report at least one WIDTH_MISMATCH_FULL");
    const first = widthIssues[0];
    assert.strictEqual(first.targetKey, "instance:button#1");
    assert.ok(first.confidence > 0);
    assert.ok(Array.isArray(first.suggestedFixes) && first.suggestedFixes.length > 0);
    assert.ok(
      first.suggestedFixes.some((f) => f.classes && f.classes.includes("w-full")),
      "suggestedFixes should include w-full"
    );
  });

  it("does not emit WIDTH_MISMATCH_FULL when output already matches parent width", () => {
    const outputRects = {
      "instance:button#1": { x: 10, y: 20, w: 380, h: 40 },
    };
    const expectedRects = {
      "instance:button#1": { x: 10, y: 20, w: 380, h: 40 },
    };
    const parentRects = {
      "instance:button#1": { x: 0, y: 0, w: 400, h: 200 },
    };
    const issues = diagnose({
      breakpoint: "desktop",
      offenderRects: [],
      outputRects,
      expectedRects,
      parentRects,
      layout: [],
    });

    const widthIssues = issues.filter((i) => i.issueType === ISSUE_TYPES.WIDTH_MISMATCH_FULL);
    assert.strictEqual(widthIssues.length, 0);
  });

  it("resolves expected key by nodeId when offender has path dataKey", () => {
    const outputRects = {
      "frame:image#1/instance:button#1": { x: 10, y: 20, w: 80, h: 40 },
    };
    const expectedRects = {
      "36:1220": { x: 10, y: 20, w: 380, h: 40 },
    };
    const parentRects = {
      "36:1220": { x: 0, y: 0, w: 400, h: 200 },
    };
    const offenderRects = [
      {
        dataKey: "frame:image#1/instance:button#1",
        nodeId: "36:1220",
        severity: 0.6,
        x: 10,
        y: 20,
        w: 80,
        h: 40,
      },
    ];
    const issues = diagnose({
      breakpoint: "desktop",
      offenderRects,
      outputRects,
      expectedRects,
      parentRects,
      layout: [
        {
          nodeId: "36:1220",
          dataKey: "frame:image#1/instance:button#1",
          tag: "button",
          className: "btn",
          bbox: { x: 10, y: 20, w: 80, h: 40 },
        },
      ],
    });
    const widthIssues = issues.filter((i) => i.issueType === ISSUE_TYPES.WIDTH_MISMATCH_FULL);
    assert.ok(widthIssues.length >= 1);
    assert.strictEqual(widthIssues[0].targetKey, "frame:image#1/instance:button#1");
  });

  it("returns empty array when no offenders and no button/CTA narrow pattern", () => {
    const issues = diagnose({
      breakpoint: "mobile",
      offenderRects: [],
      outputRects: {},
      expectedRects: {},
      parentRects: {},
      layout: [],
    });
    assert.ok(Array.isArray(issues));
    assert.strictEqual(issues.length, 0);
  });
});
