import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("section padding applies to section-like container", () => {
  const html = `
    <div data-key="root" class="grid grid-cols-1 md:grid-cols-2 gap-[3rem] pt-[5rem] pr-[5rem] pb-[5rem] pl-[5rem] max-xl:px-5 bg-[#f9fafb] w-[80rem] max-w-full">
      <div>Left</div>
      <div>Right</div>
    </div>
  `;
  const out = applyContracts({ html, slug: "section-pad" });
  const tokens = getTokensByDataKey(out.html, "root");
  assert.ok(tokens.includes("pt-[2.5rem]"));
  assert.ok(tokens.includes("pb-[2.5rem]"));
  assert.ok(tokens.includes("lg:pt-[5rem]"));
  assert.ok(tokens.includes("lg:pb-[5rem]"));
  assert.ok(tokens.includes("pr-[5rem]"));
  assert.ok(tokens.includes("pl-[5rem]"));
  assert.ok(tokens.includes("max-xl:px-5"));
});

test("section padding does not apply to buttons", () => {
  const html = `<button data-key="cta" class="pt-[5rem] pb-[5rem] pr-[2rem] pl-[2rem]">Tap</button>`;
  const out = applyContracts({ html, slug: "button" });
  const tokens = getTokensByDataKey(out.html, "cta");
  assert.ok(tokens.includes("pt-[5rem]"));
  assert.ok(tokens.includes("pb-[5rem]"));
  assert.ok(!tokens.includes("pt-[2.5rem]"));
});

test("section padding does not apply to decorative bars", () => {
  const html = `<div data-key="decorativebar-1" class="pt-[5rem] pb-[5rem] h-[0.3125rem]"></div>`;
  const out = applyContracts({ html, slug: "decorative" });
  const tokens = getTokensByDataKey(out.html, "decorativebar-1");
  assert.ok(tokens.includes("pt-[5rem]"));
  assert.ok(tokens.includes("pb-[5rem]"));
  assert.ok(!tokens.includes("pt-[2.5rem]"));
});

test("section padding preserves responsive horizontal padding", () => {
  const html = `
    <section data-key="root" class="pt-[4rem] pb-[4rem] pr-[3rem] pl-[3rem] max-xl:px-5 bg-[#fafafa]">
      <div>Child</div>
    </section>
  `;
  const out = applyContracts({ html, slug: "section-pad-2" });
  const tokens = getTokensByDataKey(out.html, "root");
  assert.ok(tokens.includes("max-xl:px-5"));
  assert.ok(tokens.includes("pt-[2.5rem]"));
  assert.ok(tokens.includes("pb-[2.5rem]"));
  assert.ok(tokens.includes("md:pt-[4rem]"));
  assert.ok(tokens.includes("md:pb-[4rem]"));
  assert.ok(tokens.includes("pr-[3rem]"));
  assert.ok(tokens.includes("pl-[3rem]"));
});
