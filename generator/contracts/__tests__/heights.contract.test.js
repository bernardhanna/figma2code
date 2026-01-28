// generator/contracts/heightsContract.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

function getFirstTagTokens(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("heights contract removes wrapper heights without image (default hug)", () => {
  const html = `
    <div data-key="frame:thumbs1#1" class="overflow-hidden w-[33.5rem] max-w-full h-[38.831875rem] self-start">
      <span>Text</span>
    </div>
  `;
  const out = applyContracts({ html, slug: "height-strip" });
  const tokens = getTokensByDataKey(out.html, "frame:thumbs1#1");
  assert.ok(!tokens.includes("h-[38.831875rem]"));
});

test("heights contract keeps image wrapper heights and adds max-md:h-auto (fixed)", () => {
  const html = `
    <div data-key="frame:imagewrap" data-h-intent="fixed" class="h-[23.769375rem] w-full">
      <img src="/x.png" />
    </div>
  `;
  const out = applyContracts({ html, slug: "height-keep" });
  const tokens = getTokensByDataKey(out.html, "frame:imagewrap");
  assert.ok(tokens.includes("h-[23.769375rem]"));
  assert.ok(tokens.includes("max-md:h-auto"));
});

test("heights contract keeps img heights and adds max-md:h-auto (fixed)", () => {
  const html = `<img data-h-intent="fixed" class="h-[23.769375rem] w-full" />`;
  const out = applyContracts({ html, slug: "img-keep" });
  const tokens = getFirstTagTokens(out.html, "img");
  assert.ok(tokens.includes("h-[23.769375rem]"));
  assert.ok(tokens.includes("max-md:h-auto"));
});

test("heights contract keeps decorative bar heights", () => {
  const html = `<div data-key="decorativebar-1" class="h-[0.3125rem] bg-black"></div>`;
  const out = applyContracts({ html, slug: "decorative" });
  const tokens = getTokensByDataKey(out.html, "decorativebar-1");
  assert.ok(tokens.includes("h-[0.3125rem]"));
});

test("heights contract removes responsive bracket heights on hug nodes", () => {
  const html = `
    <div data-key="frame:thumbs1#1" class="md:h-[38.831875rem] w-full">
      <span>Text</span>
    </div>
  `;
  const out = applyContracts({ html, slug: "height-responsive" });
  const tokens = getTokensByDataKey(out.html, "frame:thumbs1#1");
  assert.ok(!tokens.includes("md:h-[38.831875rem]"));
});

test("heights contract normalizes root fixed height to h-auto + md:h-[...]", () => {
  const html = `
    <div data-key="root" class="w-full h-[48.831875rem] max-md:h-auto">
      <span>Content</span>
    </div>
  `;
  const out = applyContracts({ html, slug: "height-root" });
  const tokens = getTokensByDataKey(out.html, "root");

  // root should become fluid by default (mobile), fixed on md+
  assert.ok(tokens.includes("h-auto"));
  assert.ok(tokens.includes("md:h-[48.831875rem]"));

  // old tokens should be gone
  assert.ok(!tokens.includes("h-[48.831875rem]"));
  assert.ok(!tokens.includes("max-md:h-auto"));
});

test("heights contract enforces fill container -> h-full (and strips bracket heights)", () => {
  const html = `
    <div data-key="frame:fill" data-h-intent="fill" class="h-[10rem] w-full">
      <span>Fill</span>
    </div>
  `;
  const out = applyContracts({ html, slug: "height-fill" });
  const tokens = getTokensByDataKey(out.html, "frame:fill");

  assert.ok(tokens.includes("h-full"));
  assert.ok(!tokens.includes("h-[10rem]"));
});

test("heights contract does not touch button heights", () => {
  const html = `
    <button data-key="btn" class="btn h-[2.75rem] px-4 py-2">OK</button>
  `;
  const out = applyContracts({ html, slug: "height-button" });
  const tokens = getTokensByDataKey(out.html, "btn");
  assert.ok(tokens.includes("h-[2.75rem]"));
});
