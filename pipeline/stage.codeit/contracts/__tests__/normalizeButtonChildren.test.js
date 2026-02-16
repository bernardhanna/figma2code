const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../semantics/buttons/normalizeButtonChildren");

test("<button><p class=\"...\">Book now</p></button> -> <button><span class=\"...\">Book now</span></button>", () => {
  const html = `<button type="button" class="btn"><p class="font-bold text-lg">Book now</p></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(!out.html.includes("<p "), "no <p> inside button");
  assert.ok(out.html.includes("<span "), "has span");
  assert.ok(out.html.includes('class="font-bold text-lg"'), "classes preserved on span");
  assert.ok(out.html.includes("Book now"));
  assert.ok(out.html.includes("<button type=\"button\""));
  assert.equal(out.stats.normalized, 1);
});

test("multiple paragraphs inside button -> multiple spans", () => {
  const html = `
    <button class="btn">
      <p class="line1">First</p>
      <p class="line2">Second</p>
    </button>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(!out.html.includes("<p "));
  const spanCount = (out.html.match(/<span\s/g) || []).length;
  assert.equal(spanCount, 2);
  assert.ok(out.html.includes("First"));
  assert.ok(out.html.includes("Second"));
  assert.ok(out.html.includes('class="line1"'));
  assert.ok(out.html.includes('class="line2"'));
  assert.equal(out.stats.normalized, 2);
});

test("button with only span is unchanged", () => {
  const html = `<button type="submit"><span class="label">Submit</span></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
  assert.ok(out.html.includes("<span class=\"label\">Submit</span>"));
});

test("button with only text nodes gets wrapped in span", () => {
  const html = `<button type="button">Click me</button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("<span>Click me</span>"));
  assert.equal(out.stats.normalized, 1);
});

test("optional: only label span with text-left and button justify-center -> text-center on span", () => {
  const html = `<button type="button" class="flex justify-center"><p class="text-left">Label</p></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(!out.html.includes("text-left"));
  assert.ok(out.html.includes("text-center"));
  assert.ok(out.html.includes("Label"));
});
