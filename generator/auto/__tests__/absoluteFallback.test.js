import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

function child(id, x, y, w, h) {
  return { id, name: id, x, y, w, h, children: [] };
}

test("low-confidence non-auto group uses bounded absolute fallback", () => {
  const node = {
    id: "parent",
    name: "Ambiguous",
    x: 0,
    y: 0,
    w: 400,
    h: 260,
    __layoutHints: {
      lowConfidence: true,
      fallbackRecommended: true,
      collectionLike: false,
    },
    children: [
      child("c1", 0, 0, 120, 80),
      child("c2", 170, 70, 120, 80),
      child("c3", 80, 160, 120, 80),
    ],
  };
  const html = renderNode(node, null, true, {}, {});
  assert.match(html, /data-layout-fallback="absolute"/);
  assert.match(html, /data-node-id="c1"[^>]*class="[^"]*absolute/);
  assert.match(html, /data-node-id="c2"[^>]*class="[^"]*absolute/);
});

test("absolute fallback is skipped when budget is exceeded", () => {
  const node = {
    id: "parent2",
    name: "Ambiguous 2",
    x: 0,
    y: 0,
    w: 400,
    h: 260,
    __layoutHints: {
      lowConfidence: true,
      fallbackRecommended: true,
      collectionLike: false,
    },
    children: [
      child("c1", 0, 0, 120, 80),
      child("c2", 170, 70, 120, 80),
      child("c3", 80, 160, 120, 80),
    ],
  };
  const html = renderNode(node, null, true, {}, { absoluteFallbackMaxNodes: 2 });
  assert.doesNotMatch(html, /data-layout-fallback="absolute"/);
});
