import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import bgPositionCleanupContract from "../bgPositionCleanup.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("removes bg-position without background image", () => {
  const html = `
    <div data-key="bg1" class="bg-[#000] bg-center"></div>
  `;
  const out = applyContracts({
    html,
    slug: "bg-pos-removed",
    contracts: [bgPositionCleanupContract],
  });
  const tokens = getTokensByDataKey(out.html, "bg1");
  assert.ok(tokens.includes("bg-[#000]"));
  assert.ok(!tokens.includes("bg-center"));
});

test("keeps bg-position when background image exists", () => {
  const html = `
    <div data-key="bg2" class="bg-[url(/x.png)] bg-center bg-cover"></div>
  `;
  const out = applyContracts({
    html,
    slug: "bg-pos-keep",
    contracts: [bgPositionCleanupContract],
  });
  const tokens = getTokensByDataKey(out.html, "bg2");
  assert.ok(tokens.includes("bg-[url(/x.png)]"));
  assert.ok(tokens.includes("bg-cover"));
  assert.ok(tokens.includes("bg-center"));
});
