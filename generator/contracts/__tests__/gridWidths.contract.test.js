import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import gridWidthsContract from "../gridWidths.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("grid widths restores fixed grid width as w-full max-w-[X]", () => {
  const html = `
    <div class="grid w-[80rem]" data-w-intent="fixed" data-w-rem="80rem"></div>
  `;
  const out = applyContracts({ html, slug: "grid-cols", contracts: [gridWidthsContract] });
  const classMatch = out.html.match(/class="([^"]*)"/);
  const tokens = classMatch ? classMatch[1].split(/\s+/g).filter(Boolean) : [];
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("max-w-[80rem]"));
  assert.ok(!tokens.includes("w-[80rem]"));
});

test("grid widths avoids duplicating max-w on parent wrapper", () => {
  const html = `
    <div class="max-w-[80rem]">
      <div class="grid w-[80rem]" data-w-intent="fixed" data-w-rem="80rem"></div>
    </div>
  `;
  const out = applyContracts({ html, slug: "grid-parent", contracts: [gridWidthsContract] });
  const gridMatch = out.html.match(/<div class="([^"]*)" data-w-intent="fixed"/);
  const tokens = gridMatch ? gridMatch[1].split(/\s+/g).filter(Boolean) : [];
  assert.ok(tokens.includes("w-full"));
  assert.ok(!tokens.includes("max-w-[80rem]"));
});
