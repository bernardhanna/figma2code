import test from "node:test";
import assert from "node:assert/strict";

import { spacingClass } from "../autoLayoutify/precision.js";
import { renderNode } from "../autoLayoutify/render.js";

test("spacingClass snaps near Tailwind scale values", () => {
  assert.equal(spacingClass("gap", 19.2), "gap-5");
  assert.equal(spacingClass("pt", 12.3), "pt-3");
  assert.equal(spacingClass("pl", 13.7), "pl-3.5");
});

test("spacingClass keeps arbitrary value when outside tolerance", () => {
  const cls = spacingClass("gap", 19, { tolerancePx: 0.2 });
  assert.equal(cls, "gap-[1.1875rem]");
});

test("spacingClass parses explicit px/rem strings safely", () => {
  assert.equal(spacingClass("pt", "20px", { tolerancePx: 0.2 }), "pt-5");
  assert.equal(spacingClass("pt", "1.25rem", { tolerancePx: 0.2 }), "pt-5");
});

test("render auto container uses quantized gap token", () => {
  const node = {
    id: "auto-root",
    name: "Auto Root",
    auto: {
      layout: "HORIZONTAL",
      itemSpacing: 19.2,
      primaryAlign: "MIN",
      counterAlign: "MIN",
    },
    children: [
      { id: "a", name: "A", children: [] },
      { id: "b", name: "B", children: [] },
    ],
  };
  const html = renderNode(node, null, true, {}, {});
  assert.ok(html.includes("gap-5"));
  assert.ok(!html.includes("gap-[1.2rem]"));
});

test("render auto container clamps oversized non-hero vertical padding to px bracket", () => {
  const node = {
    id: "auto-pad-root",
    name: "Generic section",
    auto: {
      layout: "VERTICAL",
      itemSpacing: 12,
      padT: 320,
      padB: 320,
      primaryAlign: "MIN",
      counterAlign: "MIN",
    },
    children: [{ id: "a", name: "A", children: [] }],
  };
  const html = renderNode(node, null, true, {}, {});
  assert.ok(html.includes("pt-[320px]"));
  assert.ok(html.includes("pb-[320px]"));
  assert.ok(!html.includes("pt-[20rem]"));
  assert.ok(!html.includes("pb-[20rem]"));
});
