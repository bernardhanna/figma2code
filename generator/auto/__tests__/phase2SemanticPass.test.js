// generator/auto/__tests__/phase2SemanticPass.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { semanticAccessiblePass } from "../phase2SemanticPass.js";

function countMatches(str, re) {
  const m = str.match(re);
  return m ? m.length : 0;
}

test("root hero fallback: applies banner to wrapper when wrapper has background cue; only one banner", () => {
  const rootId = "ROOT_1";

  const html = `
<section class="outer" style="background-image:url('/x.png')">
  <div data-node="${rootId}" class="inner">
    <h1>Title</h1>
  </div>
</section>
`.trim();

  const ast = {
    tree: {
      id: rootId,
      name: "Hero",
      fills: [{ kind: "image" }],
      children: [],
    },
  };

  const { html: out } = semanticAccessiblePass({
    html,
    ast,
    semantics: { enableLandmarks: true, strictLandmarks: true, rootHeroFallback: true },
  });

  // exactly one banner
  assert.equal(countMatches(out, /role="banner"/g), 1);

  // top wrapper landmark got banner + aria-labelledby
  assert.ok(/<(section|header|div)\b[^>]*role="banner"/i.test(out));
  assert.ok(/<(section|header|div)\b[^>]*aria-labelledby="ROOT_1-heading"/i.test(out));

  // heading got injected id
  assert.ok(/<h1\b[^>]*id="ROOT_1-heading"/i.test(out));

  // root node container MUST NOT also become a second banner (regression)
  assert.ok(!new RegExp(`<div\\b[^>]*data-node="${rootId}"[^>]*\\brole="banner"`, "i").test(out));
});

test("root hero fallback: if wrapper has no bg cue, allow banner on root data-node; only one banner", () => {
  const rootId = "ROOT_2";

  const html = `
<section class="outer">
  <div data-node="${rootId}" class="inner" style="background-image:url('/y.png')">
    <h1>Title</h1>
  </div>
</section>
`.trim();

  const ast = {
    tree: {
      id: rootId,
      name: "Hero",
      fills: [{ kind: "image" }],
      children: [],
    },
  };

  const { html: out } = semanticAccessiblePass({
    html,
    ast,
    semantics: { enableLandmarks: true, strictLandmarks: true, rootHeroFallback: true },
  });

  // exactly one banner
  assert.equal(countMatches(out, /role="banner"/g), 1);

  // top-level wrapper got banner + aria-labelledby
  assert.ok(/<(section|header|div)\b[^>]*role="banner"/i.test(out));
  assert.ok(new RegExp(`aria-labelledby="${rootId}-heading"`).test(out));

  // heading got injected id
  assert.ok(new RegExp(`<h1\\b[^>]*id="${rootId}-heading"`, "i").test(out));
});

test("overlay pass promotes background-like overlapping rectangle to absolute layer", () => {
  const html = `
<section data-node="p1" class="relative">
  <div data-node="o1" class="w-[20rem] h-[10rem] bg-black/40"></div>
</section>
`.trim();

  const ast = {
    tree: {
      id: "p1",
      type: "FRAME",
      name: "Hero Wrapper",
      x: 0,
      y: 0,
      w: 320,
      h: 160,
      children: [
        {
          id: "o1",
          type: "RECTANGLE",
          name: "Overlay",
          x: 0,
          y: 0,
          w: 320,
          h: 160,
          opacity: 0.5,
          fills: [{ kind: "solid" }],
          children: [],
        },
      ],
    },
  };

  const { html: out } = semanticAccessiblePass({ html, ast, semantics: {} });
  assert.match(out, /data-node="o1"[^>]*class="[^"]*absolute inset-0 pointer-events-none/);
  assert.match(out, /data-node="o1"[^>]*aria-hidden="true"/);
});

test("overlay pass classifies content-like overlaps and keeps them in flow", () => {
  const html = `
<section data-node="p2" class="relative">
  <div data-node="b1" class="px-3 py-1 bg-white rounded">New</div>
</section>
`.trim();

  const ast = {
    tree: {
      id: "p2",
      type: "FRAME",
      name: "Card",
      x: 0,
      y: 0,
      w: 320,
      h: 180,
      children: [
        {
          id: "b1",
          type: "FRAME",
          name: "Badge",
          x: 220,
          y: 8,
          w: 90,
          h: 28,
          children: [{ id: "t1", type: "TEXT", name: "text", text: { raw: "New" }, children: [] }],
        },
      ],
    },
  };

  const { html: out, report } = semanticAccessiblePass({ html, ast, semantics: {} });
  assert.doesNotMatch(out, /data-node="b1"[^>]*class="[^"]*absolute inset-0/);
  assert.ok(
    (report?.warnings || []).some((w) => String(w).includes("content-like overlay candidate")),
    "expected content-like overlay warning"
  );
});

test("semantic pass converts structural spans in button trees to div wrappers", () => {
  const html = `
<button data-node="b1" class="btn" type="button">
  <span data-node="outer" class="flex gap-1">
    <span data-node="label">Find a group</span>
    <span data-node="icon-wrap" class="overflow-hidden w-full">
      <img data-node="icon" src="/assets/icon-x.png" />
    </span>
  </span>
</button>
`.trim();

  const ast = {
    tree: {
      id: "root",
      type: "FRAME",
      name: "root",
      children: [],
    },
  };

  const { html: out } = semanticAccessiblePass({ html, ast, semantics: {} });
  assert.match(out, /<button\b[^>]*>/i);
  assert.match(out, /<div data-node="outer" class="flex gap-1">/i);
  assert.match(out, /<div data-node="icon-wrap" class="overflow-hidden w-full">/i);
  assert.match(out, /<span data-node="label">Find a group<\/span>/i);
});

test("landmark pass does not produce invalid main banner combo", () => {
  const rootId = "ROOT_MAIN_HERO";
  const html = `
<section style="background-image:url('/hero.png')">
  <div data-node="${rootId}">
    <h1>Heading</h1>
  </div>
</section>
`.trim();

  const ast = {
    tree: {
      id: rootId,
      name: "Main Hero",
      fills: [{ kind: "image", src: "/hero.png" }],
      children: [],
    },
  };

  const { html: out } = semanticAccessiblePass({
    html,
    ast,
    semantics: { enableLandmarks: true, strictLandmarks: true, rootHeroFallback: true },
  });

  assert.doesNotMatch(out, /<main\b[^>]*role="banner"/i);
  assert.match(out, /role="banner"/i);
});

test("banner wrapper does not force sibling hero media slot into header landmark", () => {
  const rootId = "ROOT_WRAP";
  const heroSlotId = "HERO_SLOT";
  const html = `
<section style="background-image:url('/hero.png')">
  <div data-node="${rootId}">
    <h1>Heading</h1>
    <div data-node="${heroSlotId}"></div>
  </div>
</section>
`.trim();

  const ast = {
    tree: {
      id: rootId,
      name: "Root",
      fills: [{ kind: "image", src: "/hero.png" }],
      children: [{ id: heroSlotId, name: "Hero", children: [] }],
    },
  };

  const { html: out } = semanticAccessiblePass({
    html,
    ast,
    semantics: { enableLandmarks: true, strictLandmarks: true, rootHeroFallback: true, upgradeTopLevelFrames: true },
  });

  assert.match(out, /role="banner"/i);
  assert.doesNotMatch(out, new RegExp(`<header\\b[^>]*data-node="${heroSlotId}"`, "i"));
});

test("hero with background-color style keeps banner on section and avoids root main upgrade", () => {
  const rootId = "ROOT_BG_COLOR";
  const html = `
<section style="background-color: rgba(0,157,230,1)">
  <div data-node="${rootId}">
    <h1>Heading</h1>
    <div data-node="hero_text_box"></div>
  </div>
</section>
`.trim();
  const ast = {
    tree: {
      id: rootId,
      name: "Main",
      fills: [{ kind: "solid", r: 0, g: 157 / 255, b: 230 / 255, a: 1 }],
      children: [{ id: "hero_text_box", name: "Hero text box", children: [] }],
    },
  };
  const { html: out } = semanticAccessiblePass({
    html,
    ast,
    semantics: { enableLandmarks: true, strictLandmarks: true, rootHeroFallback: true, upgradeTopLevelFrames: true },
  });
  assert.match(out, /<section\b[^>]*role="banner"/i);
  assert.doesNotMatch(out, new RegExp(`<main\\b[^>]*data-node="${rootId}"`, "i"));
  assert.doesNotMatch(out, /<header\b[^>]*data-node="hero_text_box"[^>]*role="banner"/i);
});

test("landmark upgrades keep root and hero text wrappers structural", () => {
  const rootId = "ROOT_STRUCTURAL";
  const heroTextId = "HERO_TEXT_WRAP";
  const html = `
<section style="background-color: rgba(0,157,230,1)">
  <div data-node="${rootId}">
    <div data-node="${heroTextId}"></div>
  </div>
</section>
`.trim();
  const ast = {
    tree: {
      id: rootId,
      name: "Main",
      fills: [{ kind: "solid", r: 0, g: 157 / 255, b: 230 / 255, a: 1 }],
      children: [{ id: heroTextId, name: "Hero text box", children: [] }],
    },
  };
  const { html: out } = semanticAccessiblePass({
    html,
    ast,
    semantics: { enableLandmarks: true, strictLandmarks: true, rootHeroFallback: false, upgradeTopLevelFrames: true },
  });
  assert.doesNotMatch(out, new RegExp(`<main\\b[^>]*data-node="${rootId}"`, "i"));
  assert.doesNotMatch(out, new RegExp(`<header\\b[^>]*data-node="${heroTextId}"`, "i"));
});
