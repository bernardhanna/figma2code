import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("renderNode emits data-w-intent for fill sizing", () => {
  const node = {
    id: "intent-root",
    name: "Intent Root",
    size: { primary: "FILL" },
    children: [],
  };
  const html = renderNode(node, null, true, {}, {});
  assert.ok(html.includes('data-w-intent="fill"'));
});

test("renderNode maps width intent from parent axis (vertical parent uses counter sizing)", () => {
  const node = {
    id: "intent-child",
    name: "Intent Child",
    size: { primary: "FILL", counter: "HUG" },
    children: [],
  };
  const html = renderNode(node, "VERTICAL", false, {}, {});
  assert.ok(html.includes('data-w-intent="hug"'));
});
