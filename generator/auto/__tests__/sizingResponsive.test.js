import test from "node:test";
import assert from "node:assert/strict";

import {
  childSizing,
  paddings,
  resolveAxisIntents,
  sizeClassForLeaf,
  widthTokensForNode,
} from "../autoLayoutify/sizing.js";

test("horizontal fixed-width child uses mobile-first responsive width tokens", () => {
  const node = {
    id: "card",
    name: "Card",
    w: 520,
    size: { primary: "FIXED" },
    children: [{ id: "inner" }],
  };
  const cls = childSizing(node, "HORIZONTAL");
  assert.match(cls, /\bw-full\b/);
  assert.ok(cls.includes("md:w-[32.5rem]"));
  assert.match(cls, /\bmax-w-full\b/);
});

test("tiny fixed-width nodes stay fixed (no mobile promotion)", () => {
  const node = {
    id: "badge",
    name: "Badge",
    w: 96,
    size: { primary: "FIXED" },
  };
  const tokens = widthTokensForNode(node, "HORIZONTAL");
  assert.ok(tokens.includes("w-[6rem]"));
  assert.ok(!tokens.includes("w-full"));
  assert.ok(!tokens.some((t) => t.startsWith("md:w-")));
});

test("media-like nodes do not get responsive fixed-width promotion", () => {
  const node = {
    id: "hero-image",
    name: "Hero image",
    w: 480,
    size: { primary: "FIXED" },
    tag: "img",
  };
  const tokens = widthTokensForNode(node, "HORIZONTAL");
  assert.ok(tokens.includes("w-[30rem]"));
  assert.ok(!tokens.includes("w-full"));
});

test("vertical parent maps fill width intent to w-full instead of fixed width", () => {
  const node = {
    id: "fill-cross-axis",
    name: "Fill cross axis",
    w: 420,
    size: { primary: "HUG", counter: "FILL" },
  };
  const cls = sizeClassForLeaf(node, "VERTICAL", false, false);
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-full"));
  assert.ok(!cls.includes("w-[26.25rem]"));
});

test("horizontal hug child does not force width class", () => {
  const node = {
    id: "hug-child",
    name: "Hug child",
    w: 360,
    size: { primary: "HUG", counter: "HUG" },
  };
  const cls = childSizing(node, "HORIZONTAL");
  assert.equal(cls.trim(), "");
});

test("horizontal tiny icon wrapper with fill intent stays fixed width", () => {
  const node = {
    id: "icon-wrap",
    name: "Icon",
    w: 20,
    h: 20,
    size: { primary: "FILL", counter: "HUG" },
    children: [{ id: "icon-leaf" }],
  };
  const cls = childSizing(node, "HORIZONTAL");
  assert.ok(cls.includes("w-[1.25rem]"));
  assert.ok(!cls.includes("grow"));
  assert.ok(!cls.includes("basis-0"));
});

test("resolveAxisIntents uses parent axis to derive width/height intents", () => {
  const node = {
    id: "axis-intent",
    size: { primary: "FILL", counter: "HUG" },
  };
  const inRow = resolveAxisIntents(node, "HORIZONTAL");
  const inCol = resolveAxisIntents(node, "VERTICAL");
  assert.equal(inRow.widthIntent, "FILL");
  assert.equal(inRow.heightIntent, "HUG");
  assert.equal(inCol.widthIntent, "HUG");
  assert.equal(inCol.heightIntent, "FILL");
});

test("large padding emits mobile cap and md: full value", () => {
  const al = { padT: 0, padR: 208, padB: 0, padL: 208 };
  const cls = paddings(al);
  assert.match(cls, /\bpr-5\b/);
  assert.match(cls, /\bxl:pr-52\b/);
  assert.match(cls, /\bpl-5\b/);
  assert.match(cls, /\bxl:pl-52\b/);
});

test("vertical fixed-width content gets responsive width (full on mobile)", () => {
  const node = {
    id: "text-frame",
    name: "Text block",
    w: 344,
    size: { primary: "FIXED" },
  };
  const tokens = widthTokensForNode(node, "VERTICAL");
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("md:w-[21.5rem]"));
  assert.ok(tokens.includes("max-w-full"));
});

test("responsive width plan prefers full->md half chain", () => {
  const node = {
    id: "planned-half",
    w: 600,
    size: { primary: "FIXED" },
    __responsivePlan: { width: { base: "full", md: "1/2" } },
  };
  const tokens = widthTokensForNode(node, "HORIZONTAL");
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("md:w-1/2"));
  assert.ok(!tokens.some((t) => /^md:w-\[/.test(t)));
});

test("responsive padding plan restores desktop spacing at lg", () => {
  const al = { padL: 96, padR: 72 };
  const cls = paddings(al, {
    responsivePlan: {
      spacing: {
        paddingX: { basePx: 20, lgLeftPx: 96, lgRightPx: 72 },
      },
    },
  });
  assert.match(cls, /\bpl-5\b/);
  assert.match(cls, /\blg:pl-24\b/);
  assert.match(cls, /\bpr-5\b/);
  assert.ok(cls.includes("lg:pr-[4.5rem]"));
});
