import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import responsiveDuplicateCleanupContract from "../responsiveDuplicateCleanup.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("removes redundant responsive duplicates", () => {
  const html = `
    <div data-key="dup" class="flex flex-col md:flex-col items-start md:items-start justify-start md:justify-start"></div>
  `;
  const out = applyContracts({
    html,
    slug: "responsive-dup",
    contracts: [responsiveDuplicateCleanupContract],
  });
  const tokens = getTokensByDataKey(out.html, "dup");
  assert.ok(tokens.includes("flex"));
  assert.ok(tokens.includes("flex-col"));
  assert.ok(tokens.includes("items-start"));
  assert.ok(tokens.includes("justify-start"));
  assert.ok(!tokens.includes("md:flex-col"));
  assert.ok(!tokens.includes("md:items-start"));
  assert.ok(!tokens.includes("md:justify-start"));
});

test("keeps responsive overrides when they differ", () => {
  const html = `
    <div data-key="keep" class="flex flex-col md:flex-row"></div>
  `;
  const out = applyContracts({
    html,
    slug: "responsive-keep",
    contracts: [responsiveDuplicateCleanupContract],
  });
  const tokens = getTokensByDataKey(out.html, "keep");
  assert.ok(tokens.includes("flex-col"));
  assert.ok(tokens.includes("md:flex-row"));
});
