import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("corner smoothing metadata emits raster fallback marker", () => {
  const html = renderNode(
    {
      id: "smooth-card",
      name: "Smooth card",
      cornerSmoothing: 0.72,
      r: { tl: 20, tr: 20, br: 20, bl: 20 },
      children: [],
    },
    null,
    false,
    {},
    {}
  );

  assert.match(html, /data-corner-smoothing="0.72"/);
  assert.match(html, /data-corner-smoothing-fallback="rasterize"/);
});

test("zero corner smoothing does not emit fallback marker", () => {
  const html = renderNode(
    {
      id: "plain-card",
      name: "Plain card",
      cornerSmoothing: 0,
      r: { tl: 20, tr: 20, br: 20, bl: 20 },
      children: [],
    },
    null,
    false,
    {},
    {}
  );

  assert.doesNotMatch(html, /data-corner-smoothing-fallback="rasterize"/);
});
