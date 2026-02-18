import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("boolean operation renders inline svg when svg markup exists", () => {
  const html = renderNode(
    {
      id: "bool-svg",
      type: "BOOLEAN_OPERATION",
      name: "Union icon",
      w: 20,
      h: 20,
      svg: {
        markup:
          '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M1 1h18v18H1z"/></svg>',
      },
      children: [],
    },
    null,
    false,
    {},
    {}
  );
  assert.match(html, /^<svg\b/i);
  assert.match(html, /<path\b/i);
  assert.doesNotMatch(html, /data-boolean-op="raster-fallback"/);
});

test("boolean operation raster fallback is marked when only image exists", () => {
  const html = renderNode(
    {
      id: "bool-raster",
      type: "BOOLEAN_OPERATION",
      name: "Subtract icon",
      img: { src: "/assets/subtract.png", w: 20, h: 20 },
      children: [],
    },
    null,
    false,
    {},
    {}
  );
  assert.match(html, /^<img\b/i);
  assert.match(html, /data-boolean-op="raster-fallback"/);
});
