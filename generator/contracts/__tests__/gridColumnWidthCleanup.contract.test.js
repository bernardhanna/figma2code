import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import gridColumnWidthCleanupContract from "../gridColumnWidthCleanup.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("removes width tokens on text inside grid columns", () => {
  const html = `
    <div class="grid">
      <div data-key="col">
        <p data-key="text" class="w-[33.5rem] max-w-full">Copy</p>
      </div>
    </div>
  `;
  const out = applyContracts({ html, slug: "grid-text", contracts: [gridColumnWidthCleanupContract] });
  const tokens = getTokensByDataKey(out.html, "text");
  assert.ok(!tokens.includes("w-[33.5rem]"));
  assert.ok(!tokens.includes("max-w-full"));
});

test("converts CTA width to w-full in grid columns", () => {
  const html = `
    <div class="grid">
      <div data-key="col">
        <button data-key="cta" class="btn w-[20rem] max-w-full">Go</button>
      </div>
    </div>
  `;
  const out = applyContracts({ html, slug: "grid-cta", contracts: [gridColumnWidthCleanupContract] });
  const tokens = getTokensByDataKey(out.html, "cta");
  assert.ok(!tokens.includes("w-[20rem]"));
  assert.ok(!tokens.includes("max-w-full"));
  assert.ok(tokens.includes("w-full"));
});

test("keeps fixed intent layout container width", () => {
  const html = `
    <div class="grid">
      <div data-key="col">
        <div data-key="fixed" data-w-intent="fixed" class="w-[10rem] max-w-full"></div>
      </div>
    </div>
  `;
  const out = applyContracts({ html, slug: "grid-fixed", contracts: [gridColumnWidthCleanupContract] });
  const tokens = getTokensByDataKey(out.html, "fixed");
  assert.ok(tokens.includes("w-[10rem]"));
  assert.ok(tokens.includes("max-w-full"));
});
