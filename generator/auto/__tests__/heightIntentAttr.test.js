import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("renderNode emits data-h-intent for fixed height in horizontal layout", () => {
  const node = {
    id: "fixed-height",
    name: "Fixed Height",
    size: { primary: "HUG", counter: "FIXED" },
    children: [],
  };
  const html = renderNode(node, "HORIZONTAL", false, {}, {});
  assert.ok(html.includes('data-h-intent="fixed"'));
});

test("renderNode emits data-h-intent for hug height in vertical layout", () => {
  const node = {
    id: "hug-height",
    name: "Hug Height",
    size: { primary: "HUG", counter: "FIXED" },
    children: [],
  };
  const html = renderNode(node, "VERTICAL", false, {}, {});
  assert.ok(html.includes('data-h-intent="hug"'));
});

test("renderNode emits data-h-intent for fill height in vertical layout", () => {
  const node = {
    id: "fill-height",
    name: "Fill Height",
    size: { primary: "FILL", counter: "FIXED" },
    children: [],
  };
  const html = renderNode(node, "VERTICAL", false, {}, {});
  assert.ok(html.includes('data-h-intent="fill"'));
});
