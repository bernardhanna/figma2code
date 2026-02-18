import test from "node:test";
import assert from "node:assert/strict";

import { boxDeco } from "../autoLayoutify/styles.js";
import { renderNode } from "../autoLayoutify/render.js";

test("background blur emits backdrop blur + backdrop-filter classes", () => {
  const cls = boxDeco(
    {
      id: "glass",
      blur: { type: "BACKGROUND", radius: 16 },
    },
    false,
    false
  );

  assert.match(cls, /backdrop-blur-\[1rem\]/);
  assert.match(cls, /\[backdrop-filter:blur\(1rem\)\]/);
  assert.match(cls, /\[-webkit-backdrop-filter:blur\(1rem\)\]/);
});

test("unsupported blur payload marks rasterize fallback attribute", () => {
  const html = renderNode(
    {
      id: "glass-unsupported",
      name: "Glass Unsupported",
      blur: { type: "MOTION", radius: 12 },
      children: [],
    },
    null,
    false,
    {},
    {}
  );

  assert.match(html, /data-blur-fallback="rasterize"/);
});
