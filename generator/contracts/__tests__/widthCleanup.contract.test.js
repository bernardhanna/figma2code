import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";

function getTokensByDataKey(html, dataKey) {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
}

test("hug/fill wrappers drop bracket widths and fill becomes w-full", () => {
  const html = `
    <div data-key="fill-node" data-w-intent="fill" class="w-[33.5rem] max-w-full"></div>
    <div data-key="hug-node" data-w-intent="hug" class="md:w-[20rem] w-[16rem]"></div>
  `;
  const out = applyContracts({ html, slug: "width-cleanup" });
  const fillTokens = getTokensByDataKey(out.html, "fill-node");
  const hugTokens = getTokensByDataKey(out.html, "hug-node");
  assert.ok(!fillTokens.includes("w-[33.5rem]"));
  assert.ok(fillTokens.includes("w-full"));
  assert.ok(!hugTokens.includes("w-[16rem]"));
  assert.ok(!hugTokens.includes("md:w-[20rem]"));
});

test("fixed intent keeps width", () => {
  const html = `<div data-key="fixed-node" data-w-intent="fixed" class="w-[24rem]"></div>`;
  const out = applyContracts({ html, slug: "fixed" });
  const tokens = getTokensByDataKey(out.html, "fixed-node");
  assert.ok(tokens.includes("w-[24rem]"));
});

test("nested repeated widths collapse for non-fixed", () => {
  const html = `
    <div data-key="parent" data-w-intent="fixed" class="w-[70rem]">
      <div data-key="child" data-w-intent="hug" class="w-[70rem]"></div>
    </div>
  `;
  const out = applyContracts({ html, slug: "collapse" });
  const childTokens = getTokensByDataKey(out.html, "child");
  assert.ok(!childTokens.includes("w-[70rem]"));
});

test("max-w-full removed when safe, kept on img and typography", () => {
  const html = `
    <div data-key="wrapper" class="max-w-full"></div>
    <p data-key="text" class="max-w-full text-[1rem]"></p>
    <img data-key="img" class="max-w-full" />
  `;
  const out = applyContracts({ html, slug: "max-w" });
  const wrapperTokens = getTokensByDataKey(out.html, "wrapper");
  const textTokens = getTokensByDataKey(out.html, "text");
  const imgTokens = getTokensByDataKey(out.html, "img");
  assert.ok(!wrapperTokens.includes("max-w-full"));
  assert.ok(textTokens.includes("max-w-full"));
  assert.ok(imgTokens.includes("max-w-full"));
});
