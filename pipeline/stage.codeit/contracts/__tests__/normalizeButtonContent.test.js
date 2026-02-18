const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../semantics/interactive/normalizeButtonContent");

test("button with only phrasing content is no-op", () => {
  const html = `<button type="button" class="btn"><span>Click</span></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
  assert.ok(out.html.includes("<span>Click</span>"));
  assert.ok(out.html.includes("<button "));
});

test("button containing <div> converts div to span", () => {
  const html = `<button type="button" class="btn p-4"><div class="flex">Label</div></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 1);
  assert.ok(!out.html.includes("<div "), "no div inside button");
  assert.ok(out.html.includes("<span "), "div became span");
  assert.ok(out.html.includes('class="flex"'), "classes preserved");
  assert.ok(out.html.includes("Label"));
});

test("button containing <p> and <h3> converts both to span", () => {
  const html = `<button type="button"><p class="mb-0">Line</p><h3 class="text-lg">Title</h3></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 2);
  assert.ok(!out.html.includes("<p "));
  assert.ok(!out.html.includes("<h3"));
  const spanCount = (out.html.match(/<span\s/g) || []).length;
  assert.ok(spanCount >= 2);
  assert.ok(out.html.includes("Line"));
  assert.ok(out.html.includes("Title"));
});

test("button with nested block: inner div becomes span", () => {
  const html = `<button><span><div class="inner">Nested</div></span></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 1);
  assert.ok(!out.html.includes("<div "));
  assert.ok(out.html.includes('class="inner"'));
  assert.ok(out.html.includes("Nested"));
});

test("non-button block content is untouched", () => {
  const html = `<div><p>In div</p></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
  assert.ok(out.html.includes("<p>"));
});
