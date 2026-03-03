import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExpectedRects } from "../expected.js";
import { parseHtmlNodeIndex } from "../utils.js";
import { detectWidthFullIssues, RULE_WIDTH_MISMATCH_FULL } from "../rules/widthFull.js";

test("widthFull proposes w-full for narrow CTA", () => {
  const ast = {
    tree: {
      id: "root",
      key: "root",
      bb: { x: 0, y: 0, w: 400, h: 200 },
      children: [
        {
          id: "btn",
          key: "frame:cta/instance:button#1",
          bb: { x: 20, y: 100, w: 360, h: 44 },
          children: [],
        },
      ],
    },
  };
  const expected = computeExpectedRects(ast);
  const html = `<button data-node-id="btn" data-key="frame:cta/instance:button#1" class="inline-flex w-fit">Go</button>`;
  const nodeIndex = parseHtmlNodeIndex(html);
  const issues = detectWidthFullIssues({
    bp: "mobile",
    offenders: [{ nodeId: "btn", dataKey: "frame:cta/instance:button#1", severity: 0.8 }],
    rects: {
      "frame:cta/instance:button#1": { x: 20, y: 100, w: 120, h: 44 },
      "frame:cta": { x: 20, y: 90, w: 360, h: 60 },
    },
    expected,
    nodeIndex,
  });

  assert.ok(issues.length > 0);
  assert.equal(issues[0].issueType, RULE_WIDTH_MISMATCH_FULL);
  assert.equal(issues[0].candidates[0].patches[0].classes.includes("w-full"), true);
});

