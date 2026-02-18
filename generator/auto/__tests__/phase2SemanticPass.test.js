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
