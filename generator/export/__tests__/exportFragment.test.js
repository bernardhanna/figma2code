import test from "node:test";
import assert from "node:assert/strict";

import { previewHtml } from "../../templates/preview.html.js";
import { extractPreviewFragment, sanitizePreviewHtml, selectRootFragment } from "../index.js";
import { escAttr } from "../../auto/autoLayoutify/escape.js";
import { parseHtmlNodes } from "../../contracts/contractTypes.js";

function extractTextNodes(html) {
  const nodes = [];
  let buffer = "";
  let inTag = false;
  let quote = null;

  for (let i = 0; i < html.length; i += 1) {
    const ch = html[i];

    if (!inTag) {
      if (ch === "<") {
        if (buffer.trim()) nodes.push(buffer);
        buffer = "";
        inTag = true;
        quote = null;
      } else {
        buffer += ch;
      }
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === ">") {
      inTag = false;
    }
  }

  if (!inTag && buffer.trim()) nodes.push(buffer);
  return nodes;
}

test("export outputs root fragment only", () => {
  const ast = {
    slug: "demo",
    frame: { w: 1200, h: 400 },
    tree: { w: 1200, h: 400, id: "root", name: "Demo", children: [] },
    meta: {},
  };

  const fragment =
    `<div class="wrap">` +
    `<section data-key="root"><div data-node-id="I1:2">Hello</div></section>` +
    `</div>`;

  const html = previewHtml(ast, { fragment });
  const fragmentFromPreview = extractPreviewFragment(html);
  const rootFragment = selectRootFragment(fragmentFromPreview);
  const sanitized = sanitizePreviewHtml(rootFragment);

  assert.ok(rootFragment.trim().startsWith("<section"));
  assert.match(sanitized, /data-key="root"/);
  assert.doesNotMatch(sanitized, /<!doctype/i);
  assert.doesNotMatch(sanitized, /<head/i);
});

test("fragment parses cleanly without leaked id text", () => {
  const rawSvg = "<svg><path d=\"M0 0\"/></svg>";
  const styleValue = `background-image:url("data:image/svg+xml;utf8,${rawSvg}")`;
  const fragment =
    `<div data-node-id="I1:2" style="${escAttr(styleValue)}">` +
    `<span data-node-id="I1:3">ok</span>` +
    `</div>`;

  const nodes = parseHtmlNodes(fragment);
  assert.equal(nodes.filter((node) => node.tag === "div").length, 1);
  assert.equal(nodes.filter((node) => node.tag === "span").length, 1);
  assert.equal(
    nodes.some((node) => node.tag === "svg" || node.tag === "path"),
    false
  );

  const textNodes = extractTextNodes(fragment);
  assert.equal(
    textNodes.some((text) => /(?:^|\s)(?:e-id="|node-id="|data-node-id)/.test(text)),
    false
  );
});
