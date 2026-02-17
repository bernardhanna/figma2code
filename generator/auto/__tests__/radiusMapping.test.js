import test from "node:test";
import assert from "node:assert/strict";

import { boxDeco } from "../autoLayoutify/styles.js";

test("asymmetric corner radii map to per-corner classes", () => {
  const cls = boxDeco(
    {
      r: { tl: 12, tr: 0, br: 24, bl: 6 },
    },
    false,
    false
  );
  assert.ok(cls.includes("rounded-tl-[0.75rem]"));
  assert.ok(cls.includes("rounded-br-[1.5rem]"));
  assert.ok(cls.includes("rounded-bl-[0.375rem]"));
  assert.ok(!cls.includes("rounded-["));
});

test("uniform corner radius maps to a single rounded token", () => {
  const cls = boxDeco(
    {
      r: { tl: 16, tr: 16, br: 16, bl: 16 },
    },
    false,
    false
  );
  assert.ok(cls.includes("rounded-[1rem]"));
  assert.ok(!cls.includes("rounded-tl-["));
});

test("single cornerRadius value is mapped uniformly", () => {
  const cls = boxDeco(
    {
      cornerRadius: 20,
    },
    false,
    false
  );
  assert.ok(cls.includes("rounded-[1.25rem]"));
});
