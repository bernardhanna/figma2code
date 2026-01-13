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

  const { html: out } = semanticAccessiblePass({ html, ast, semantics: {} });

  // exactly one banner
  assert.equal(countMatches(out, /\brole="banner"\b/g), 1);

  // wrapper got banner + aria-labelledby
  assert.ok(/<section\b[^>]*\brole="banner"\b/i.test(out));
  assert.ok(/<section\b[^>]*\baria-labelledby="ROOT_1-heading"\b/i.test(out));

  // heading got injected id
  assert.ok(/<h1\b[^>]*\bid="ROOT_1-heading"\b/i.test(out));

  // root node container MUST NOT also become a banner (regression)
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

  const { html: out } = semanticAccessiblePass({ html, ast, semantics: {} });

  // exactly one banner
  assert.equal(countMatches(out, /\brole="banner"\b/g), 1);

  // root node container got banner + aria-labelledby
  assert.ok(new RegExp(`<div\\b[^>]*data-node="${rootId}"[^>]*\\brole="banner"`, "i").test(out));
  assert.ok(new RegExp(`data-node="${rootId}"[^>]*aria-labelledby="${rootId}-heading"`, "i").test(out));

  // wrapper did NOT get banner (since it has no bg cue)
  assert.ok(!/<section\b[^>]*\brole="banner"\b/i.test(out));

  // heading got injected id
  assert.ok(new RegExp(`<h1\\b[^>]*\\bid="${rootId}-heading"\\b`, "i").test(out));
});
