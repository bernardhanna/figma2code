import test from "node:test";
import assert from "node:assert/strict";

import { boxDeco } from "../autoLayoutify/styles.js";

test("boxDeco encodes gradient background as a single Tailwind class token", () => {
  const node = {
    fills: [
      {
        kind: "gradient",
        type: "LINEAR",
        angle: 136.520773,
        stops: [
          { r: 5 / 255, g: 157 / 255, b: 237 / 255, a: 1, pos: 0 },
          { r: 40 / 255, g: 178 / 255, b: 250 / 255, a: 1, pos: 0.91 },
        ],
      },
    ],
  };

  const cls = boxDeco(node, false, false);
  assert.match(cls, /bg-\[linear-gradient\(.+\)\]/);
  assert.ok(!cls.includes("bg-[linear-gradient(") || !/\bbg-\[linear-gradient\([^)]*\),\s/.test(cls));

  const tokens = cls.split(/\s+/).filter(Boolean);
  const gradientToken = tokens.find((t) => t.startsWith("bg-[linear-gradient("));
  assert.ok(gradientToken, "expected a gradient arbitrary value token");
  assert.ok(!gradientToken.includes(" "), "gradient token must not contain spaces");
});
