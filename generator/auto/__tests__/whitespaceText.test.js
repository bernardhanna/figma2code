import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("text without newlines omits whitespace-pre-wrap", () => {
  const node = {
    id: "text-normal",
    name: "Text",
    text: {
      raw: "hello world",
      fontSize: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      align: "left",
    },
  };
  const html = renderNode(node, null, false, {}, {});
  assert.ok(!html.includes("whitespace-pre-wrap"));
});

test("text with newlines keeps whitespace-pre-wrap", () => {
  const node = {
    id: "text-pre-wrap",
    name: "Text",
    text: {
      raw: "hello\nworld",
      fontSize: 16,
      fontWeight: 400,
      lineHeightPx: 24,
      align: "left",
    },
  };
  const html = renderNode(node, null, false, {}, {});
  assert.ok(html.includes("whitespace-pre-wrap"));
});
