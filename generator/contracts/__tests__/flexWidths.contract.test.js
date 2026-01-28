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

test("flex widths normalize 2-col children", () => {
  const html = `
    <div class="flex md:flex-row">
      <div data-key="col-1" class="w-[33.5rem] max-w-full">Left</div>
      <div data-key="col-2" class="w-[33.5rem] max-w-full">Right</div>
    </div>
  `;
  const out = applyContracts({ html, slug: "flex-cols" });
  const col1 = getTokensByDataKey(out.html, "col-1");
  const col2 = getTokensByDataKey(out.html, "col-2");
  assert.ok(!col1.includes("w-[33.5rem]"));
  assert.ok(!col2.includes("w-[33.5rem]"));
  assert.ok(col1.includes("w-full"));
  assert.ok(col1.includes("md:w-1/2"));
  assert.ok(col2.includes("w-full"));
  assert.ok(col2.includes("md:w-1/2"));
});


test("flex widths remove nested descendant bracket widths", () => {
  const html = `
    <div class="flex">
      <div data-key="col-1" class="w-[33.5rem] max-w-full">
        <div data-key="nested" class="flex flex-col w-[20rem] max-w-full">Nested</div>
      </div>
      <div data-key="col-2" class="w-[33.5rem] max-w-full">Right</div>
    </div>
  `;
  const out = applyContracts({ html, slug: "flex-nested" });
  const nested = getTokensByDataKey(out.html, "nested");
  assert.ok(!nested.includes("w-[20rem]"));
});

test("flex widths keep decorativebar widths", () => {
  const html = `
    <div class="flex">
      <div data-key="col-1" class="w-[33.5rem] max-w-full">
        <div data-key="decorativebar-1" class="w-[10rem]"></div>
      </div>
      <div data-key="col-2" class="w-[33.5rem] max-w-full">Right</div>
    </div>
  `;
  const out = applyContracts({ html, slug: "flex-decorative" });
  const decorative = getTokensByDataKey(out.html, "decorativebar-1");
  assert.ok(decorative.includes("w-[10rem]"));
});

test("flex widths keep img widths", () => {
  const html = `
    <div class="flex">
      <div data-key="col-1" class="w-[33.5rem] max-w-full">
        <img class="w-[10rem]" src="/x.png" />
      </div>
      <div data-key="col-2" class="w-[33.5rem] max-w-full">Right</div>
    </div>
  `;
  const out = applyContracts({ html, slug: "flex-img" });
  const imgTokens = getFirstTagTokens(out.html, "img");
  assert.ok(imgTokens.includes("w-[10rem]"));
});
