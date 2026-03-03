import { test } from "node:test";
import assert from "node:assert/strict";
import { runConstraintEngine } from "../engine.js";
import { validateIssueShape } from "../utils.js";

test("engine returns deterministic ranked issues in strict patch format", () => {
  const ast = {
    tree: {
      id: "root",
      key: "root",
      bb: { x: 0, y: 0, w: 400, h: 300 },
      children: [
        {
          id: "btn",
          key: "section/instance:button#1",
          bb: { x: 16, y: 220, w: 368, h: 44 },
          children: [],
        },
      ],
    },
  };
  const html = `<button data-node-id="btn" data-key="section/instance:button#1" class="inline-flex">Run</button>`;
  const input = {
    report: {
      offenders: {
        mobile: [{ nodeId: "btn", dataKey: "section/instance:button#1", severity: 0.9 }],
        tablet: [],
        desktop: [],
      },
    },
    rectsByBp: {
      mobile: {
        "section/instance:button#1": { x: 16, y: 220, w: 140, h: 44 },
        section: { x: 16, y: 200, w: 368, h: 80 },
      },
      tablet: {},
      desktop: {},
    },
    ast,
    html,
  };

  const a = runConstraintEngine(input);
  const b = runConstraintEngine(input);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
  assert.equal(validateIssueShape(a[0]), true);
});

