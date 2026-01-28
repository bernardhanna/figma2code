import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";

function getFirstTag(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*>`, "i");
  return String(html || "").match(regex)?.[0] || "";
}

test("cta with instance button converts to button", () => {
  const html = `
    <div data-key="frame/instance:button#1" data-w-intent="fixed" class="btn inline-flex w-[33.5rem]">
      <p class="w-[10.25rem]">Book now via Calendly</p>
    </div>
  `;
  const out = applyContracts({ html, slug: "cta-basic" });
  assert.ok(out.html.includes("<button"));
  assert.ok(out.html.includes('type="button"'));
});

test("btn div with data-href becomes link", () => {
  const html = `<div class="btn" data-href="https://example.com">Label</div>`;
  const out = applyContracts({ html, slug: "cta-link" });
  assert.ok(out.html.includes("<a"));
  assert.ok(out.html.includes('href="https://example.com"'));
});

test("tile card with heading and decorative bar stays div", () => {
  const html = `
    <div class="btn hover:bg-[#d9f1fc]">
      <h3>Title</h3>
      <div data-decorative="1" class="h-[0.25rem] w-[4rem] bg-[#000]"></div>
    </div>
  `;
  const out = applyContracts({ html, slug: "cta-tile" });
  assert.ok(out.html.includes("<div"));
  assert.ok(!out.html.includes("<button"));
});

test("complex children are preserved", () => {
  const html = `
    <div class="btn" data-href="https://example.com">
      <svg viewBox="0 0 10 10"></svg>
      <p>Label</p>
    </div>
  `;
  const out = applyContracts({ html, slug: "cta-complex" });
  assert.ok(out.html.includes("<a"));
  assert.ok(out.html.includes("<svg"));
  assert.ok(out.html.includes("<p>Label</p>"));
});

test("non-interactive btn stays div", () => {
  const html = `<div class="btn hover:bg-[#d9f1fc]">Card</div>`;
  const out = applyContracts({ html, slug: "cta-card" });
  assert.ok(out.html.includes("<div"));
  assert.ok(!out.html.includes("<button"));
  assert.ok(!out.html.includes("<a"));
});
