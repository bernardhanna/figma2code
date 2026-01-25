import test from "node:test";
import assert from "node:assert/strict";

import { previewHtml } from "../preview.html.js";

test("preview HTML includes Tailwind loader and fragment classes", () => {
  const ast = {
    slug: "demo",
    frame: { w: 1200, h: 400 },
    tree: { w: 1200, h: 400, id: "root", name: "Demo", children: [] },
    meta: {},
  };

  const fragment = `<div class="flex gap-4"><span class="text-sm">Hello</span></div>`;
  const html = previewHtml(ast, { fragment });

  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /tailwind\.config/);
  assert.match(html, /class=&quot;flex gap-4&quot;/);
});
