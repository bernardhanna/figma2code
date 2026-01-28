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
