const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/normalizeContainerWidths");

const getClass = (html) => {
  const m = String(html || "").match(/class="([^"]*)"/);
  return m ? m[1].trim() : "";
};

const hasToken = (cls, token) => {
  const tokens = cls.split(/\s+/).filter(Boolean);
  return tokens.includes(token);
};

test("w-full max-w-[80rem] mx-auto ... w-[80rem] -> w-[80rem] removed", () => {
  const html = `<div class="w-full max-w-[80rem] mx-auto px-4 w-[80rem]">Content</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(hasToken(cls, "w-full"));
  assert.ok(hasToken(cls, "max-w-[80rem]"));
  assert.ok(hasToken(cls, "mx-auto"));
  assert.ok(!hasToken(cls, "w-[80rem]"), "fixed width token removed");
  assert.equal(out.stats.normalized, 1);
});

test("mx-auto max-w-container w-[60rem] -> w-[60rem] removed, w-full ensured", () => {
  const html = `<div class="mx-auto max-w-container w-[60rem] py-8">Content</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(hasToken(cls, "w-full"));
  assert.ok(hasToken(cls, "max-w-container"));
  assert.ok(hasToken(cls, "mx-auto"));
  assert.ok(!hasToken(cls, "w-[60rem]"));
  assert.equal(out.stats.normalized, 1);
});

test("w-[33.5rem] max-w-full (no mx-auto) -> unchanged", () => {
  const html = `<div class="w-[33.5rem] max-w-full">Content</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
  assert.ok(out.html.includes("w-[33.5rem]"));
  assert.ok(out.html.includes("max-w-full"));
});

test("container with responsive fixed width md:w-[80rem] removes it", () => {
  const html = `<section class="w-full max-w-[80rem] mx-auto md:w-[80rem]">Content</section>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(hasToken(cls, "w-full"));
  assert.ok(!hasToken(cls, "w-[80rem]") && !hasToken(cls, "md:w-[80rem]"));
  assert.equal(out.stats.normalized, 1);
});

test("img with w-[28rem] max-w-full mx-auto is untouched", () => {
  const html = `<img src="x" class="w-[28rem] max-w-full mx-auto" alt="">`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
  assert.ok(out.html.includes("w-[28rem]"));
});
