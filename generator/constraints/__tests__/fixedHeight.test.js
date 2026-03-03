import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlNodeIndex } from "../utils.js";
import { detectFixedHeightIssues, RULE_FIXED_HEIGHT_WRAPPER } from "../rules/fixedHeight.js";

test("fixedHeight flags non-media wrapper with clipping and h-[...]", () => {
  const html = `
    <div data-node-id="wrap" data-key="wrapper" class="flex flex-col h-[20rem]">
      <div data-node-id="c1" data-key="wrapper/child#1" class="h-[18rem]"></div>
    </div>
  `;
  const nodeIndex = parseHtmlNodeIndex(html);
  const issues = detectFixedHeightIssues({
    bp: "mobile",
    offenders: [{ nodeId: "wrap", dataKey: "wrapper", severity: 0.8 }],
    rects: {
      wrapper: { x: 0, y: 0, w: 300, h: 200 },
      "wrapper/child#1": { x: 0, y: 0, w: 300, h: 240 },
    },
    expected: {
      parentByKey: { "wrapper/child#1": "wrapper" },
      childrenByKey: { wrapper: ["wrapper/child#1"] },
      rects: { wrapper: { x: 0, y: 0, w: 300, h: 260 } },
    },
    nodeIndex,
  });
  assert.ok(issues.length > 0);
  assert.equal(issues[0].issueType, RULE_FIXED_HEIGHT_WRAPPER);
  assert.equal(issues[0].candidates[0].patches[0].op, "classRemove");
});

