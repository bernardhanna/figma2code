import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("mask path emits svg clip-path style and mask type marker", () => {
  const html = renderNode(
    {
      id: "masked-shape",
      name: "Masked shape",
      maskPath: "M0,0 L100,0 L100,100 Z",
      children: [],
    },
    null,
    false,
    {},
    {}
  );
  assert.match(html, /data-mask-type="svg"/);
  assert.match(html, /clip-path:\s*path\('/);
  assert.match(html, /-webkit-clip-path:\s*path\('/);
});

test("unsupported mask metadata marks rasterize fallback", () => {
  const html = renderNode(
    {
      id: "mask-fallback",
      name: "Mask fallback",
      isMask: true,
      maskType: "LUMINANCE",
      children: [],
    },
    null,
    false,
    {},
    {}
  );
  assert.match(html, /data-mask-fallback="rasterize"/);
});

test("rectangular clip uses overflow-hidden and no raster fallback marker", () => {
  const html = renderNode(
    {
      id: "rect-clip",
      name: "Rect clip",
      clipsContent: true,
      children: [],
    },
    null,
    false,
    {},
    {}
  );
  assert.match(html, /overflow-hidden/);
  assert.doesNotMatch(html, /data-mask-fallback="rasterize"/);
});
