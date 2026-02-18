const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/grid/stripFlexChildSizing");

const getClassByKey = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("removes flex sizing tokens from grid children", () => {
  const html = `
    <div class="grid grid-cols-2 gap-6">
      <div data-key="card1" class="flex-1 grow basis-0 min-w-0 self-center flex flex-col"></div>
      <div data-key="card2" class="grow basis-0"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const c1 = getClassByKey(out.html, "card1");
  const c2 = getClassByKey(out.html, "card2");
  assert.ok(!c1.includes("flex-1"));
  assert.ok(!c1.includes("grow"));
  assert.ok(!c1.includes("basis-0"));
  assert.ok(!c1.includes("self-center"));
  assert.ok(!c1.includes("min-w-0"), "min-w-0 removed when no overflow hint");
  assert.ok(c1.includes("flex"), "keeps internal flex layout");
  assert.ok(!c2.includes("grow"));
  assert.ok(!c2.includes("basis-0"));
  assert.equal(out.stats.stripped, 2);
});

test("keeps min-w-0 when child is flex and has overflow hints", () => {
  const html = `
    <div class="grid grid-cols-2">
      <div data-key="card3" class="flex min-w-0 truncate"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const c3 = getClassByKey(out.html, "card3");
  assert.ok(c3.includes("min-w-0"), "min-w-0 retained with truncate");
  assert.equal(out.stats.stripped, 0);
});
