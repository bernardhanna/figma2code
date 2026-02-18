const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../semantics/buttons/promoteInteractiveFrames");

test("div with btn, hover:*, focus-visible:*, px-* and only text -> becomes <button type=\"button\">", () => {
  const html = `
    <div class="btn hover:bg-gray-100 focus-visible:ring-2 px-4 py-2 rounded">
      Click me
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("<button "));
  assert.ok(out.html.includes('type="button"'));
  assert.ok(out.html.includes("btn hover:bg-gray-100"));
  assert.ok(out.html.includes("Click me"));
  assert.ok(out.html.includes("<span>"));
  assert.equal(out.stats.promoted, 1);
});

test("complex div with multiple children -> no-op", () => {
  const html = `
    <div class="btn px-4 py-2 cursor-pointer">
      <span>Line 1</span>
      <span>Line 2</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.promoted, 0);
  assert.ok(out.html.includes("<div "));
  assert.ok(out.html.includes("Line 1"));
  assert.ok(out.html.includes("Line 2"));
});

test("div with single <p> child -> button with inner span", () => {
  const html = `<div class="btn px-3 py-2 focus-visible:ring hover:shadow"><p class="font-bold">Book now</p></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("<button "));
  assert.ok(out.html.includes('type="button"'));
  assert.ok(!out.html.includes("<p "));
  assert.ok(out.html.includes("<span "));
  assert.ok(out.html.includes('class="font-bold"'));
  assert.ok(out.html.includes("Book now"));
  assert.equal(out.stats.promoted, 1);
});

test("div containing <a href> is not promoted", () => {
  const html = `<div class="btn px-4 py-2"><a href="/page">Link</a></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.promoted, 0);
  assert.ok(out.html.includes("<div "));
});

test("already button is no-op", () => {
  const html = `<button type="button" class="btn px-4">Submit</button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.promoted, 0);
});
