import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import containerMirrorTextWidthContract from "../containerMirrorTextWidth.contract.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("removes mirrored heading width and data-w-rem", () => {
  const html = `
    <div data-key="parent" data-w-rem="70rem" class="w-[70rem]">
      <h2 data-key="child" data-w-rem="70rem" class="w-[70rem] max-w-full">Title</h2>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "mirror",
    contracts: [containerMirrorTextWidthContract],
  });
  const childTokens = getTokensByDataKey(out.html, "child");
  assert.ok(!childTokens.includes("w-[70rem]"));
  assert.ok(!/data-key="child"[^>]*data-w-rem="70rem"/i.test(out.html));
});

test("does not remove non-mirrored width", () => {
  const html = `
    <div data-key="parent" class="w-[70rem]">
      <h3 data-key="child" class="w-[20rem]">Title</h3>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "non-mirror",
    contracts: [containerMirrorTextWidthContract],
  });
  const childTokens = getTokensByDataKey(out.html, "child");
  assert.ok(childTokens.includes("w-[20rem]"));
});

test("does not run inside decorative context", () => {
  const html = `
    <div data-key="decorativebar" data-decorative="1" class="w-[70rem]">
      <h2 data-key="child" class="w-[70rem]">Title</h2>
    </div>
  `;
  const out = applyContracts({
    html,
    slug: "decorative",
    contracts: [containerMirrorTextWidthContract],
  });
  const childTokens = getTokensByDataKey(out.html, "child");
  assert.ok(childTokens.includes("w-[70rem]"));
});
