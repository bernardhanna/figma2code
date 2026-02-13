const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/enforceWidthIntent");

const getAttr = (html, attr) => {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1] : "";
};

test("fixed intent with no width becomes fill with w-full max-w-full", () => {
  const html = `<div data-w-intent="fixed" class="flex flex-col"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  const intent = getAttr(out.html, "data-w-intent");
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-full"));
  assert.equal(intent, "fill");
  assert.equal(out.stats.enforced, 1);
});

test("fixed intent with data-w-rem on decorative keeps fixed width", () => {
  const html = `<div data-w-intent="fixed" data-w-rem="4.4375rem" data-decorative="1" class="flex"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  const intent = getAttr(out.html, "data-w-intent");
  assert.ok(cls.includes("w-[4.4375rem]"));
  assert.equal(intent, "fixed");
});

test("fixed intent on text uses w-[rem] and preserves fixed intent", () => {
  const html = `<h2 data-w-intent="fixed" data-w-rem="70rem" class="w-full max-w-full"></h2>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  const intent = getAttr(out.html, "data-w-intent");
  assert.ok(cls.includes("w-[70rem]"));
  assert.ok(!cls.includes("w-full"));
  assert.ok(!cls.includes("max-w-full"));
  assert.equal(intent, "fixed");
});

test("fixed intent on media is allowed exception", () => {
  const html = `<img data-w-intent="fixed" class="" />`;
  const out = apply({ html, artifact: {}, options: {} });
  const intent = getAttr(out.html, "data-w-intent");
  assert.equal(intent, "fixed");
  assert.equal(out.stats.enforced, 0);
});
