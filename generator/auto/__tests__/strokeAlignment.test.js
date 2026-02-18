import test from "node:test";
import assert from "node:assert/strict";

import { boxDeco } from "../autoLayoutify/styles.js";

function mkNode(align) {
  return {
    stroke: {
      weight: 4,
      align,
      color: { r: 1, g: 0, b: 0, a: 1 },
    },
  };
}

test("inside stroke maps to border classes", () => {
  const cls = boxDeco(mkNode("INSIDE"), false, false);
  assert.ok(cls.includes("border-[0.25rem]"));
  assert.ok(!cls.includes("outline-[0.25rem]"));
});

test("outside stroke maps to outline classes (no border growth)", () => {
  const cls = boxDeco(mkNode("OUTSIDE"), false, false);
  assert.ok(cls.includes("outline-[0.25rem]"));
  assert.ok(cls.includes("outline-offset-0"));
});

test("center stroke splits into half border + half outline", () => {
  const cls = boxDeco(mkNode("CENTER"), false, false);
  assert.ok(cls.includes("border-[0.125rem]"));
  assert.ok(cls.includes("outline-[0.125rem]"));
  assert.ok(cls.includes("outline-offset-0"));
});
