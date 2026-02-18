import test from "node:test";
import assert from "node:assert/strict";

import { shadowClassFromNode } from "../autoLayoutify/styles.js";

test("serializes multiple drop shadows into one Tailwind arbitrary shadow token", () => {
  const cls = shadowClassFromNode({
    shadows: [
      { x: 0, y: 8, blur: 24, spread: 0, r: 0, g: 0, b: 0, a: 0.2 },
      { x: 0, y: 2, blur: 6, spread: 0, r: 0, g: 0, b: 0, a: 0.12 },
    ],
  });
  assert.ok(cls.startsWith("shadow-["));
  assert.ok(cls.includes("0rem_0.5rem_1.5rem_rgba(0,0,0,0.2)"));
  assert.ok(cls.includes("0rem_0.125rem_0.375rem_rgba(0,0,0,0.12)"));
  assert.ok(cls.includes(","));
});

test("serializes inner shadow from effects as inset shadow", () => {
  const cls = shadowClassFromNode({
    effects: [
      {
        type: "INNER_SHADOW",
        offsetX: 0,
        offsetY: 1,
        radius: 3,
        spread: 1,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
      },
    ],
  });
  assert.ok(cls.includes("inset_"));
  assert.ok(cls.includes("_0.0625rem_rgba(0,0,0,0.25)"));
});
