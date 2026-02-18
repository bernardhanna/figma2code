const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/classes/dedupeConflictsHard");

const getClass = (html) => {
  const match = String(html || "").match(/class="([^"]*)"/i);
  return match ? match[1].trim() : "";
};

test("prefers arbitrary gap value over standard gap", () => {
  const html = `<div class="gap-2 gap-[1rem]"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(cls.includes("gap-[1rem]"));
  assert.ok(!cls.includes("gap-2"));
  assert.equal(out.stats.resolved, 1);
});

test("drops generic gap when gap-x/gap-y exist", () => {
  const html = `<div class="gap-4 gap-y-2"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(cls.includes("gap-y-2"));
  assert.ok(!cls.includes("gap-4"));
});

test("keeps last justify/items per breakpoint", () => {
  const html = `<div class="justify-center justify-start items-center md:items-start items-end"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(cls.includes("justify-start"));
  assert.ok(!cls.includes("justify-center"));
  assert.ok(cls.includes("items-end"));
  assert.ok(!cls.includes("items-center"));
  assert.ok(cls.includes("md:items-start"));
});
