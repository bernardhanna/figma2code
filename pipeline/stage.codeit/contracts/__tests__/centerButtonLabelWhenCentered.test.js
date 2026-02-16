const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../semantics/buttons/centerButtonLabelWhenCentered");

const getClass = (html, tag = "span") => {
  const regex = new RegExp(`<${tag}[^>]*class="([^"]*)"`, "i");
  const m = String(html || "").match(regex);
  return m ? m[1].trim() : "";
};

const hasToken = (cls, token) => cls.split(/\s+/).includes(token);

test("button with justify-center and single span with text-left => text-center on label", () => {
  const html = `<button type="button" class="flex justify-center px-4 py-2"><span class="font-bold text-left">Submit</span></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  const spanClass = getClass(out.html, "span");
  assert.ok(!hasToken(spanClass, "text-left"));
  assert.ok(hasToken(spanClass, "text-center"));
  assert.ok(out.html.includes("justify-center"));
  assert.equal(out.stats.adjusted, 1);
});

test("multi-element button (icon + text) => no change", () => {
  const html = `
    <button type="button" class="flex justify-center gap-2">
      <span class="icon">★</span>
      <span class="text-left">Label</span>
    </button>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.adjusted, 0);
  assert.ok(out.html.includes("text-left"));
});

test("button without justify-center => no change", () => {
  const html = `<button class="flex justify-start px-4"><span class="text-left">Label</span></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.adjusted, 0);
  assert.ok(out.html.includes("text-left"));
});

test("button with single p child and text-left => text-center", () => {
  const html = `<button type="button" class="flex justify-center"><p class="text-left m-0">Book</p></button>`;
  const out = apply({ html, artifact: {}, options: {} });
  const pClass = getClass(out.html, "p");
  assert.ok(!hasToken(pClass, "text-left"));
  assert.ok(hasToken(pClass, "text-center"));
  assert.equal(out.stats.adjusted, 1);
});
