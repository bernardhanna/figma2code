const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/normalizeCenteredContainers");

const getClass = (html) => {
  const m = String(html || "").match(/class="([^"]*)"/);
  return m ? m[1].trim() : "";
};

const hasToken = (cls, token) => {
  const tokens = cls.split(/\s+/).filter(Boolean);
  return tokens.includes(token);
};

test("w-full max-w-[80rem] mx-auto ... w-[80rem] => remove w-[80rem]", () => {
  const html = `<div class="w-full max-w-[80rem] mx-auto px-4 w-[80rem]">Content</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(hasToken(cls, "w-full"));
  assert.ok(hasToken(cls, "max-w-[80rem]"));
  assert.ok(hasToken(cls, "mx-auto"));
  assert.ok(!hasToken(cls, "w-[80rem]"));
  assert.equal(out.stats.normalized, 1);
});

test("mx-auto max-w-container w-[60rem] => remove w-[60rem] and ensure w-full", () => {
  const html = `<div class="mx-auto max-w-container w-[60rem] py-8">Content</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(hasToken(cls, "w-full"));
  assert.ok(hasToken(cls, "max-w-container"));
  assert.ok(hasToken(cls, "mx-auto"));
  assert.ok(!hasToken(cls, "w-[60rem]"));
  assert.equal(out.stats.normalized, 1);
});

test("w-[33.5rem] max-w-full (no mx-auto) => unchanged", () => {
  const html = `<div class="w-[33.5rem] max-w-full">Content</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
  assert.ok(out.html.includes("w-[33.5rem]"));
});
