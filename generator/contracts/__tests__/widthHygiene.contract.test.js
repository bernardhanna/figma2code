import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import widthHygieneContract from "../widthHygiene.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("removes bracket width and max-w-full on text when parent constrains width", () => {
  const html = `
    <div data-key="parent" class="w-[70rem]">
      <p data-key="text" class="w-[70rem] max-w-full">Text</p>
    </div>
  `;
  const out = applyContracts({ html, slug: "text", contracts: [widthHygieneContract] });
  const tokens = getTokensByDataKey(out.html, "text");
  assert.ok(!tokens.includes("w-[70rem]"));
  assert.ok(!tokens.includes("max-w-full"));
});

test("does not touch fixed intent text widths", () => {
  const html = `
    <div data-key="parent" class="w-[70rem]">
      <h2 data-key="text" data-w-intent="fixed" class="w-[20rem] max-w-full">Title</h2>
    </div>
  `;
  const out = applyContracts({ html, slug: "fixed", contracts: [widthHygieneContract] });
  const tokens = getTokensByDataKey(out.html, "text");
  assert.ok(tokens.includes("w-[20rem]"));
  assert.ok(tokens.includes("max-w-full"));
});

test("does not touch grid or flex containers", () => {
  const html = `<div data-key="grid" class="grid w-[70rem] max-w-full"></div>`;
  const out = applyContracts({ html, slug: "grid", contracts: [widthHygieneContract] });
  const tokens = getTokensByDataKey(out.html, "grid");
  assert.ok(tokens.includes("w-[70rem]"));
  assert.ok(tokens.includes("max-w-full"));
});
