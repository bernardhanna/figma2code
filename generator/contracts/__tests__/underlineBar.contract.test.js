import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("underline bar converts border tokens to solid bar", () => {
  const html = `
    <div data-key="underline" data-w-rem="6.25rem" class="pb-[1.5rem] border-[0.5rem] border-[rgba(239,123,16,1)] w-[6.25rem] max-w-full"></div>
  `;
  const out = applyContracts({ html, slug: "underline" });
  const tokens = getTokensByDataKey(out.html, "underline");
  assert.ok(tokens.includes("h-[0.5rem]"));
  assert.ok(tokens.includes("bg-[rgba(239,123,16,1)]"));
  assert.ok(!tokens.some((token) => token.startsWith("border-")));
  assert.ok(!tokens.some((token) => token.startsWith("pb-")));
  assert.ok(tokens.includes("w-[6.25rem]"));
  assert.ok(tokens.includes("max-w-full"));
});

test("underline bar adds width from data-w-rem", () => {
  const html = `
    <div data-key="underline" data-w-rem="4rem" class="border-[0.25rem] border-[#ef7b10] max-w-full"></div>
  `;
  const out = applyContracts({ html, slug: "underline-width" });
  const tokens = getTokensByDataKey(out.html, "underline");
  assert.ok(tokens.includes("w-[4rem]"));
});

test("underline bar marks decorative nodes and converts border", () => {
  const html = `
    <div data-key="decorativebarhorizontal" data-w-rem="6.25rem" class="border-[0.5rem] border-[#ef7b10] max-w-full"></div>
  `;
  const out = applyContracts({ html, slug: "decorative" });
  const tokens = getTokensByDataKey(out.html, "decorativebarhorizontal");
  assert.ok(tokens.includes("h-[0.5rem]"));
  assert.ok(tokens.includes("bg-[#ef7b10]"));
  assert.ok(tokens.includes("w-[6.25rem]"));
  assert.ok(out.html.includes('data-decorative="1"'));
});
