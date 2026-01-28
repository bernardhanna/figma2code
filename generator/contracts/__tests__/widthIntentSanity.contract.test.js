import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import widthIntentSanityContract from "../widthIntentSanity.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("fill removes data-w-rem and bracket widths, adds w-full", () => {
  const html = `
    <div data-key="fill" data-w-intent="fill" data-w-rem="34rem" class="md:w-[34rem] w-[34rem] grow"></div>
  `;
  const out = applyContracts({ html, slug: "fill", contracts: [widthIntentSanityContract] });
  const tokens = getTokensByDataKey(out.html, "fill");
  assert.ok(!out.html.includes('data-w-rem="34rem"'));
  assert.ok(!tokens.includes("w-[34rem]"));
  assert.ok(!tokens.includes("md:w-[34rem]"));
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("grow"));
});

test("decorative removes data-w-rem and max-w tokens only", () => {
  const html = `
    <div data-key="decorativebar" data-decorative="1" data-w-rem="6.25rem" class="w-[6.25rem] max-w-full md:max-w-[10rem] h-[0.5rem]"></div>
  `;
  const out = applyContracts({ html, slug: "decorative", contracts: [widthIntentSanityContract] });
  const tokens = getTokensByDataKey(out.html, "decorativebar");
  assert.ok(!out.html.includes('data-w-rem="6.25rem"'));
  assert.ok(!tokens.includes("max-w-full"));
  assert.ok(!tokens.includes("md:max-w-[10rem]"));
  assert.ok(tokens.includes("w-[6.25rem]"));
  assert.ok(tokens.includes("h-[0.5rem]"));
});

test("background-image wrapper is skipped", () => {
  const html = `
    <div data-key="bg" data-w-intent="fill" data-w-rem="10rem" class="bg-[url(/x.png)] w-[10rem]"></div>
  `;
  const out = applyContracts({ html, slug: "bg", contracts: [widthIntentSanityContract] });
  assert.ok(out.html.includes('data-w-rem="10rem"'));
  assert.ok(out.html.includes("w-[10rem]"));
});
