import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatches } from "../applyPatches.js";

test("applyPatches is idempotent for classAdd", () => {
  const html = `<button data-key="cta" class="btn">Go</button>`;
  const patches = [{ targetKey: "cta", op: "classAdd", classes: ["w-full"] }];
  const once = applyPatches(html, patches);
  const twice = applyPatches(once.html, patches);
  assert.equal(once.html, twice.html);
  assert.match(once.html, /class="btn w-full"/);
});

test("applyPatches removes classes by target key", () => {
  const html = `<div data-key="wrap" class="flex h-[20rem] overflow-hidden"></div>`;
  const out = applyPatches(html, [{ targetKey: "wrap", op: "classRemove", classes: ["h-[20rem]"] }]);
  assert.ok(!out.html.includes("h-[20rem]"));
  assert.ok(out.html.includes("overflow-hidden"));
});

