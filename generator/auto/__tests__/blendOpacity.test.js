import test from "node:test";
import assert from "node:assert/strict";

import { boxDeco } from "../autoLayoutify/styles.js";
import { renderNode } from "../autoLayoutify/render.js";

test("boxDeco maps common blend mode and opacity to stable classes", () => {
  const cls = boxDeco(
    {
      opacity: 0.4,
      blendMode: "MULTIPLY",
    },
    false,
    false
  );
  assert.ok(cls.includes("opacity-40"));
  assert.ok(cls.includes("mix-blend-multiply"));
});

test("boxDeco accepts percentage-like opacity values", () => {
  const cls = boxDeco(
    {
      opacity: 75,
      blendMode: "SCREEN",
    },
    false,
    false
  );
  assert.ok(cls.includes("opacity-75"));
  assert.ok(cls.includes("mix-blend-screen"));
});

test("group opacity/blend are emitted on wrapper container", () => {
  const html = renderNode(
    {
      id: "group",
      name: "Overlay Group",
      auto: { layout: "VERTICAL", itemSpacing: 8, primaryAlign: "MIN", counterAlign: "MIN" },
      opacity: 0.5,
      blendMode: "OVERLAY",
      children: [
        { id: "child1", name: "A", children: [] },
      ],
    },
    null,
    true,
    {},
    {}
  );
  assert.match(html, /data-node-id="group"[^>]*class="[^"]*opacity-50/);
  assert.match(html, /data-node-id="group"[^>]*class="[^"]*mix-blend-overlay/);
});
