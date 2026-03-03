import { test } from "node:test";
import assert from "node:assert/strict";

import { runConstraintEngine } from "../../constraints/engine.js";
import { applyPatches } from "../applyPatches.js";
import { shouldRollbackRegression } from "../loop.js";

test("auto-fix smoke: narrow CTA gets w-full candidate and improves mocked score", () => {
  const ast = {
    tree: {
      id: "root",
      key: "root",
      bb: { x: 0, y: 0, w: 400, h: 280 },
      children: [
        {
          id: "btn1",
          key: "section/instance:button#1",
          bb: { x: 20, y: 220, w: 360, h: 44 },
          children: [],
        },
      ],
    },
  };
  const html = `<button data-node-id="btn1" data-key="section/instance:button#1" class="inline-flex w-fit">Join</button>`;
  const input = {
    report: {
      offenders: {
        mobile: [{ nodeId: "btn1", dataKey: "section/instance:button#1", severity: 0.9 }],
        tablet: [],
        desktop: [],
      },
    },
    rectsByBp: {
      mobile: {
        "section/instance:button#1": { x: 20, y: 220, w: 130, h: 44 },
        section: { x: 20, y: 200, w: 360, h: 80 },
      },
      tablet: {},
      desktop: {},
    },
    ast,
    html,
  };
  const issues = runConstraintEngine(input);
  assert.ok(issues.length > 0);
  const topCandidate = issues[0].candidates[0];
  const patched = applyPatches(html, topCandidate.patches);
  assert.ok(/w-full/.test(patched.html));

  const scoreBefore = /w-full/.test(html) ? 0.99 : 0.75;
  const scoreAfter = /w-full/.test(patched.html) ? 0.99 : 0.75;
  assert.ok(scoreAfter > scoreBefore);
});

test("auto-fix smoke: rollback triggers on worsened score", () => {
  const before = 0.92;
  const after = 0.88;
  assert.equal(shouldRollbackRegression(before, after, 0.005), true);
});

