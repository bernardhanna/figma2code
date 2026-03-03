import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAst } from "../normalizeAst.js";
import { autoLayoutify } from "../autoLayoutify/index.js";

test("normalizeAst moves root image fill to hero media slot and disables bg image", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero Section",
      fills: [{ kind: "image", src: "/assets/hero-bg.png" }],
      children: [
        {
          id: "left",
          name: "hero text box",
          w: 344,
          children: [],
        },
        {
          id: "media",
          name: "Hero",
          key: "frame:hero#1",
          w: 768,
          children: [],
        },
      ],
    },
    __bg: {},
  };

  const out = normalizeAst(ast);
  assert.equal(out.__bg?.enabled, false);
  assert.equal(out.__bg?.src, "");
  assert.equal(out.tree.children[1]?.img?.src, "/assets/hero-bg.png");
});

test("autoLayoutify keeps hero section background color-only when media slot exists", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero Section",
      fills: [
        { kind: "solid", r: 0, g: 157 / 255, b: 230 / 255, a: 1 },
        { kind: "image", src: "/assets/hero-bg.png" },
      ],
      children: [
        { id: "left", name: "hero text box", w: 344, children: [] },
        { id: "media", name: "Hero", key: "frame:hero#1", w: 768, children: [] },
      ],
    },
    __bg: {},
  };

  const normalized = normalizeAst(ast);
  const html = autoLayoutify(normalized, { wrap: true });
  assert.match(html, /background-image:\s*linear-gradient\(rgba\(0,157,230,1\),\s*rgba\(0,157,230,1\)\)/);
  assert.doesNotMatch(html, /background-image:[^"]*url\('\/assets\/hero-bg\.png'\)/);
  assert.match(html, /data-node-id="media"[\s\S]*<img\b[^>]*src="\/assets\/hero-bg\.png"/);
});

test("normalizeAst prefers root fill for hero media slot and ignores overlay frame url", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero Section",
      fills: [{ kind: "image", src: "/assets/root-bg-should-not-win.png" }],
      children: [
        { id: "left", name: "hero text box", w: 344, children: [] },
        { id: "media", name: "Image frame", key: "frame:image#1", children: [] },
      ],
    },
    meta: {
      overlay: { src: "/assets/hero-overlay.png" },
    },
    __bg: {},
  };

  const out = normalizeAst(ast);
  assert.equal(out.tree.children[1]?.img?.src, "/assets/root-bg-should-not-win.png");
  assert.equal(out.__bg?.source, "media-slot");
  assert.equal(out.__bg?.src, "");
});

test("normalizeAst does not inject responsive overlay asset into hero media slot", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero Section",
      fills: [{ kind: "image", src: "/assets/root-bg-should-not-win.png" }],
      children: [
        { id: "left", name: "hero text box", w: 344, children: [] },
        { id: "media", name: "Image frame", key: "frame:image#1", children: [] },
      ],
    },
    meta: {
      responsive: {
        assets: {
          desktop: { overlay: "/assets/hero-overlay-desktop.png" },
        },
      },
    },
    __bg: {},
  };

  const out = normalizeAst(ast);
  assert.equal(out.tree.children[1]?.img?.src, "/assets/root-bg-should-not-win.png");
  assert.equal(out.__bg?.source, "media-slot");
  assert.equal(out.__bg?.src, "");
});

test("normalizeAst uses descendant media fill inside hero slot when available", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Hero Section",
      fills: [{ kind: "image", src: "/assets/root-should-not-win.png" }],
      children: [
        { id: "left", name: "hero text box", w: 344, children: [] },
        {
          id: "media",
          name: "Image frame",
          key: "frame:image#1",
          children: [
            {
              id: "media-inner",
              name: "rectangle image",
              fills: [{ kind: "image", src: "/assets/actual-fill.png" }],
              children: [],
            },
          ],
        },
      ],
    },
    __bg: {},
  };

  const out = normalizeAst(ast);
  assert.equal(out.tree.children[1]?.img?.src, "/assets/actual-fill.png");
  assert.equal(out.__bg?.source, "media-slot");
  assert.equal(out.__bg?.src, "");
});

