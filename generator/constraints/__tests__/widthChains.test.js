import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtmlNodeIndex } from "../utils.js";
import { detectWidthChainIssues, RULE_WIDTH_CHAIN_CONFLICT } from "../rules/widthChains.js";

test("widthChains removes inner fixed width when nested conflicts", () => {
  const html = `
    <div data-node-id="p" data-key="root/frame#1" class="w-[40rem]">
      <div data-node-id="c" data-key="root/frame#1/frame#2" class="w-[20rem]"></div>
    </div>
  `;
  const nodeIndex = parseHtmlNodeIndex(html);
  const issues = detectWidthChainIssues({
    bp: "desktop",
    rects: {
      "root/frame#1": { x: 0, y: 0, w: 640, h: 300 },
      "root/frame#1/frame#2": { x: 0, y: 0, w: 220, h: 100 },
    },
    expected: {
      rects: { "root/frame#1/frame#2": { x: 0, y: 0, w: 360, h: 100 } },
    },
    nodeIndex,
  });
  assert.ok(issues.length > 0);
  assert.equal(issues[0].issueType, RULE_WIDTH_CHAIN_CONFLICT);
  assert.equal(issues[0].candidates[0].patches[0].op, "classRemove");
});

