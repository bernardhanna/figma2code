import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import widthNoiseContract from "../widthNoise.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("removes duplicate fixed width from child", () => {
  const html = `
    <div data-key="parent" class="w-[10rem] max-w-full">
      <h2 data-key="child" class="w-[10rem] max-w-full">X</h2>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "width-noise-fixed",
    contracts: [widthNoiseContract],
  });
  const tokens = getTokensByDataKey(out.html, "child");
  assert.ok(!tokens.includes("w-[10rem]"));
  assert.ok(!tokens.includes("max-w-full"));
});

test("keeps child fixed width when parent differs", () => {
  const html = `
    <div data-key="parent" class="w-full">
      <div data-key="child" class="w-[10rem]">X</div>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "width-noise-diff",
    contracts: [widthNoiseContract],
  });
  const tokens = getTokensByDataKey(out.html, "child");
  assert.ok(tokens.includes("w-[10rem]"));
});

test("respects responsive variants and removes duplicates", () => {
  const html = `
    <div data-key="parent" class="w-full md:w-[12rem]">
      <div data-key="child" class="w-full md:w-[12rem]">X</div>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "width-noise-variants",
    contracts: [widthNoiseContract],
  });
  const tokens = getTokensByDataKey(out.html, "child");
  assert.ok(!tokens.includes("md:w-[12rem]"));
  assert.ok(!tokens.includes("w-full"));
});

test("skips nodes with flex sizing tokens", () => {
  const html = `
    <div data-key="parent" class="w-full max-w-full">
      <div data-key="child" class="w-full max-w-full grow basis-0 min-w-0">X</div>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "width-noise-flex",
    contracts: [widthNoiseContract],
  });
  const tokens = getTokensByDataKey(out.html, "child");
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("max-w-full"));
});
