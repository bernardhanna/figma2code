const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../media/img/normalizeIconChips");

const getClass = (html) => {
  const m = String(html || "").match(/class="([^"]*)"/i);
  return m ? m[1] : "";
};

test("icon chip img uses square width from height", () => {
  const html = `<img class="h-[3.5rem] rounded-[6.25rem] rounded-full object-contain max-w-full w-full" src="/x.svg" alt="icon">`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(cls.includes("h-[3.5rem]"));
  assert.ok(cls.includes("w-[3.5rem]"));
  assert.ok(!cls.includes(" w-full"));
  assert.ok(!cls.includes("rounded-[6.25rem]"));
});

test("non-chip images stay unchanged", () => {
  const html = `<img class="w-full h-auto object-cover" src="/x.png" alt="image">`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html);
  assert.ok(cls.includes("w-full"));
  assert.equal(out.stats.normalized, 0);
});

