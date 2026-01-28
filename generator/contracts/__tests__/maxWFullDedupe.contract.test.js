import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import maxWFullDedupeContract from "../maxWFullDedupe.contract.js";

function getFirstTagTokens(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("dedupes max-w-full and removes in safest case", () => {
  const html = `<div class="max-w-full max-w-full"></div>`;
  const out = applyContracts({ html, slug: "dedupe", contracts: [maxWFullDedupeContract] });
  const tokens = getFirstTagTokens(out.html, "div");
  assert.ok(!tokens.includes("max-w-full"));
});

test("keeps max-w-full on typography node", () => {
  const html = `<p class="max-w-full break-words">Long</p>`;
  const out = applyContracts({ html, slug: "typo", contracts: [maxWFullDedupeContract] });
  const tokens = getFirstTagTokens(out.html, "p");
  assert.ok(tokens.includes("max-w-full"));
});

test("keeps max-w-full on sized node", () => {
  const html = `<div class="w-[10rem] max-w-full"></div>`;
  const out = applyContracts({ html, slug: "sized", contracts: [maxWFullDedupeContract] });
  const tokens = getFirstTagTokens(out.html, "div");
  assert.ok(tokens.includes("max-w-full"));
});
