import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import semanticRestoreWidthCleanupContract from "../semanticRestoreWidthCleanup.contract.js";

test("restores h2 and p tags from styled divs", () => {
  const html = `
    <div data-key="text:headline" data-ff="Playfair" class="text-[2.125rem] font-[600] leading-[2.5rem]">Title</div>
    <div data-key="text:body" data-ff="Montserrat" class="text-[1.125rem] font-[500]">Copy</div>
  `;
  const out = applyContracts({ html, slug: "semantic", contracts: [semanticRestoreWidthCleanupContract] });
  assert.ok(out.html.includes("<h2"));
  assert.ok(out.html.includes(">Title</h2>"));
  assert.ok(out.html.includes("<p"));
  assert.ok(out.html.includes(">Copy</p>"));
});

test("removes max-w-full when parent is w-full", () => {
  const html = `
    <div class="w-full">
      <p data-key="text:body" data-ff="Montserrat" class="max-w-full text-[1rem] font-[400]">Copy</p>
    </div>
  `;
  const out = applyContracts({ html, slug: "maxw", contracts: [semanticRestoreWidthCleanupContract] });
  assert.ok(!out.html.includes("max-w-full"));
});

test("keeps max-w-full on shrink scenario", () => {
  const html = `
    <div class="flex w-full">
      <p data-key="text:body" data-ff="Montserrat" class="max-w-full w-[10rem] shrink-0">Copy</p>
    </div>
  `;
  const out = applyContracts({ html, slug: "shrink", contracts: [semanticRestoreWidthCleanupContract] });
  assert.ok(out.html.includes("max-w-full"));
});
