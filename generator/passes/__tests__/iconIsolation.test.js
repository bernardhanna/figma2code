import test from "node:test";
import assert from "node:assert/strict";

import { iconIsolationPass, isIconCandidate } from "../iconIsolationPass.js";
import { normalizeAst } from "../../auto/normalizeAst.js";

test("simple vector icon is isolated into one svg node", () => {
  const ast = {
    slug: "icon-simple",
    type: "flexi_block",
    tree: {
      id: "icon-root",
      name: "icon",
      type: "GROUP",
      w: 24,
      h: 24,
      bb: { x: 10, y: 20, w: 24, h: 24 },
      children: [
        {
          id: "v1",
          name: "Vector 1",
          type: "VECTOR",
          relX: 0,
          relY: 0,
          w: 24,
          h: 24,
          vector: { d: "M2 12L22 12" },
          children: [],
        },
      ],
    },
  };

  const out = iconIsolationPass(ast);
  assert.equal(out.tree.type, "svg");
  assert.equal(out.tree.__lockedLayout, true);
  assert.equal(Array.isArray(out.tree.children), true);
  assert.equal(out.tree.children.length, 0);
  assert.equal(typeof out.tree.svg, "string");
  assert.match(out.tree.svg, /<svg/i);
  assert.match(out.tree.svg, /preserveAspectRatio="xMidYMid meet"/i);
});

test("nested vector groups are collapsed into a single svg node", () => {
  const iconNode = {
    id: "icon-wrap",
    name: "advocacy",
    type: "GROUP",
    w: 32,
    h: 32,
    bb: { x: 0, y: 0, w: 32, h: 32 },
    children: [
      {
        id: "g1",
        name: "Group",
        type: "GROUP",
        relX: 0,
        relY: 0,
        children: [
          {
            id: "v1",
            name: "Vector",
            type: "VECTOR",
            relX: 2,
            relY: 2,
            vector: { d: "M2 2L30 2" },
            children: [],
          },
          {
            id: "v2",
            name: "Vector",
            type: "VECTOR",
            relX: 2,
            relY: 6,
            vector: { d: "M2 6L30 6" },
            children: [],
          },
        ],
      },
      {
        id: "v3",
        name: "Vector",
        type: "VECTOR",
        relX: 4,
        relY: 10,
        vector: { d: "M4 10L28 26" },
        children: [],
      },
    ],
  };

  assert.equal(isIconCandidate(iconNode), true);
  const ast = { slug: "nested-icon", type: "flexi_block", tree: iconNode };
  const out = iconIsolationPass(ast);
  assert.equal(out.tree.type, "svg");
  assert.equal(out.tree.__lockedLayout, true);
  assert.equal(out.tree.children.length, 0);
  assert.match(out.tree.svg, /<g transform=/i);
});

test("mixed vector and text subtree is not treated as an icon", () => {
  const ast = {
    slug: "mixed-content",
    type: "flexi_block",
    tree: {
      id: "mixed-root",
      name: "icon with label",
      type: "GROUP",
      w: 64,
      h: 24,
      children: [
        {
          id: "v1",
          name: "Vector",
          type: "VECTOR",
          vector: { d: "M1 1L20 1" },
          children: [],
        },
        {
          id: "t1",
          name: "Label",
          type: "TEXT",
          text: { raw: "Advocacy" },
          children: [],
        },
      ],
    },
  };
  const out = iconIsolationPass(ast);
  assert.equal(out.tree.type, "GROUP");
  assert.equal(Array.isArray(out.tree.children), true);
  assert.equal(out.tree.children.length, 2);
});

test("isolated icon remains svg after normalizeAst", () => {
  const ast = {
    slug: "normalize-stability",
    type: "flexi_block",
    tree: {
      id: "icon",
      name: "arrow",
      type: "GROUP",
      w: 16,
      h: 16,
      children: [
        {
          id: "arrow-v",
          name: "Vector",
          type: "VECTOR",
          vector: { d: "M2 8L12 8M8 4L12 8L8 12" },
          children: [],
        },
      ],
    },
  };
  const isolated = iconIsolationPass(ast);
  const normalized = normalizeAst(isolated);
  assert.equal(normalized.tree.type, "svg");
  assert.equal(normalized.tree.__lockedLayout, true);
  assert.equal(typeof normalized.tree.svg, "string");
  assert.match(normalized.tree.svg, /<path/i);
});

test("vector shard images are consolidated into one svg image stack", () => {
  const ast = {
    slug: "icon-raster-shards",
    type: "flexi_block",
    tree: {
      id: "icon-wrap",
      name: "care icon",
      type: "GROUP",
      w: 32,
      h: 32,
      children: [
        {
          id: "v1",
          name: "Vector A",
          type: "VECTOR",
          relX: 1,
          relY: 2,
          w: 10,
          h: 6,
          img: { src: "/assets/vector-a.png", w: 10, h: 6 },
          children: [],
        },
        {
          id: "v2",
          name: "Vector B",
          type: "VECTOR",
          relX: 7,
          relY: 8,
          w: 9,
          h: 5,
          img: { src: "/assets/vector-b.png", w: 9, h: 5 },
          children: [],
        },
      ],
    },
  };

  const out = iconIsolationPass(ast);
  assert.equal(out.tree.type, "svg");
  assert.equal(out.tree.__lockedLayout, true);
  assert.match(out.tree.svg, /<image /i);
  assert.match(out.tree.svg, /href="\/assets\/vector-a\.png"/i);
  assert.match(out.tree.svg, /href="\/assets\/vector-b\.png"/i);
});

test("icon-like single image leaf is isolated to svg layer", () => {
  const ast = {
    slug: "icon-single-image",
    type: "flexi_block",
    tree: {
      id: "icon-wrap",
      name: "cta icon wrapper",
      type: "GROUP",
      w: 24,
      h: 24,
      children: [
        {
          id: "icon-leaf",
          name: "Icon",
          type: "RECTANGLE",
          relX: 0,
          relY: 0,
          w: 14,
          h: 14,
          img: { src: "/assets/icon-mltar33k.png", w: 14, h: 14 },
          children: [],
        },
      ],
    },
  };

  const out = iconIsolationPass(ast);
  assert.equal(out.tree.type, "svg");
  assert.equal(out.tree.__lockedLayout, true);
  assert.match(out.tree.svg, /<image /i);
  assert.match(out.tree.svg, /href="\/assets\/icon-mltar33k\.png"/i);
});

