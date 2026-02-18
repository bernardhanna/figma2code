import test from "node:test";
import assert from "node:assert/strict";

import { detectSectionBackground } from "../autoLayoutify/background.js";
import { autoLayoutify } from "../autoLayoutify/index.js";

test("detectSectionBackground preserves fill stack with gradient + image + blend", () => {
  const root = {
    id: "root",
    name: "Hero",
    w: 1200,
    h: 640,
    fills: [
      {
        kind: "gradient",
        type: "LINEAR",
        angle: 180,
        blendMode: "MULTIPLY",
        stops: [
          { r: 1, g: 1, b: 1, a: 0, pos: 0 },
          { r: 0, g: 0, b: 0, a: 0.45, pos: 1 },
        ],
      },
      {
        kind: "image",
        src: "/assets/hero.jpg",
        objectFit: "contain",
        objectPosition: "center top",
      },
    ],
    children: [],
  };

  const bg = detectSectionBackground(root, { tree: root });
  assert.ok(String(bg.css).includes("linear-gradient("));
  assert.ok(String(bg.css).includes("url('/assets/hero.jpg')"));
  assert.ok(String(bg.blendMode).includes("multiply"));
  assert.ok(String(bg.size).includes("contain"));
  assert.ok(String(bg.position).includes("center top"));
});

test("autoLayoutify emits stacked background style properties", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero",
      w: 1200,
      h: 640,
      fills: [
        {
          kind: "solid",
          r: 0.1,
          g: 0.2,
          b: 0.3,
          a: 0.9,
        },
        {
          kind: "image",
          src: "/assets/hero.jpg",
          objectFit: "cover",
          objectPosition: "center",
        },
      ],
      children: [],
    },
    meta: {},
  };

  const html = autoLayoutify(ast, { wrap: true });
  assert.ok(html.includes("background-image:"));
  assert.ok(html.includes("background-size:"));
  assert.ok(html.includes("background-repeat:"));
});

test("autoLayoutify does not emit empty video background markers", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero",
      w: 1200,
      h: 640,
      fills: [
        {
          kind: "video",
          // Missing src should not become data-bg-type="video"
          poster: "/assets/hero.jpg",
        },
      ],
      children: [],
    },
    meta: {},
  };

  const html = autoLayoutify(ast, { wrap: true });
  assert.ok(!html.includes('data-bg-type="video"'));
  assert.ok(html.includes("background-image:"));
  assert.ok(html.includes("/assets/hero.jpg"));
});
