import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("width intent removes fixed widths for fill nodes", () => {
  const html = `
    <div data-key="fill-node" data-w-intent="fill" class="md:w-[20rem] w-[33.5rem] max-w-full">
      Content
    </div>
  `;
  const out = applyContracts({ html, slug: "intent-fill" });
  const tokens = getTokensByDataKey(out.html, "fill-node");
  assert.ok(!tokens.includes("w-[33.5rem]"));
  assert.ok(!tokens.includes("md:w-[20rem]"));
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("max-w-full"));
});

test("width intent allows fixed widths for fixed nodes", () => {
  const html = `<div data-key="fixed-node" data-w-intent="fixed" class="w-[24rem]"></div>`;
  const out = applyContracts({ html, slug: "intent-fixed" });
  const tokens = getTokensByDataKey(out.html, "fixed-node");
  assert.ok(tokens.includes("w-[24rem]"));
});
