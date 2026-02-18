const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/display/dedupeDisplay");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("element with flex flex-col and inline-flex becomes flex flex-col only (removes inline-flex)", () => {
  const html = `
    <div data-key="card" class="flex flex-col gap-4 p-4 btn inline-flex rounded-lg">Content</div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "card");
  assert.ok(cls.includes("flex"), "should keep flex");
  assert.ok(cls.includes("flex-col"), "should keep flex-col");
  assert.ok(!cls.includes("inline-flex"), "should remove inline-flex");
  assert.ok(out.stats.deduped >= 1);
});

test("button <a> with only inline-flex retains inline-flex", () => {
  const html = `
    <a data-key="cta" href="#" class="btn inline-flex items-center gap-2">Click</a>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "cta");
  assert.ok(cls.includes("inline-flex"), "should keep inline-flex");
  const tokens = cls.split(/\s+/);
  assert.ok(!tokens.includes("flex"), "should not add standalone flex (no flex-col/row)");
});

test("grid container with grid-cols-2 and flex becomes grid-only", () => {
  const html = `
    <div data-key="grid-container" class="grid grid-cols-2 flex gap-4">A</div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "grid-container");
  assert.ok(cls.includes("grid"), "should keep grid");
  assert.ok(cls.includes("grid-cols-2"), "should keep grid-cols-2");
  assert.ok(!cls.includes("flex"), "should remove flex");
  assert.ok(out.stats.deduped >= 1);
});
