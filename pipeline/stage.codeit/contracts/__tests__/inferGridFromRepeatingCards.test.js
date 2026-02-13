const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/layoutModel/inferGridFromRepeatingCards");

test("converts repeating cards to grid", () => {
  const html = `
    <div class="flex flex-col gap-[1.5rem]">
      <div class="bg-[#eee] p-4">A</div>
      <div class="bg-[#eee] p-4">B</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("grid"));
  assert.ok(out.html.includes("md:grid-cols-2"));
  assert.ok(out.html.includes("gap-[1.5rem]"));
  assert.equal(out.stats.upgraded, 1);
});

test("flattens row wrappers into a grid", () => {
  const html = `
    <div class="flex flex-col gap-6">
      <div class="md:flex-row gap-6 flex">
        <div class="bg-[#eee] p-4">A</div>
        <div class="bg-[#eee] p-4">B</div>
      </div>
      <div class="md:flex-row gap-6 flex">
        <div class="bg-[#eee] p-4">C</div>
        <div class="bg-[#eee] p-4">D</div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("grid"));
  assert.ok(out.html.includes("md:grid-cols-2"));
  assert.ok(!out.html.includes("md:flex-row"), "row wrappers removed");
  assert.ok(out.stats.upgraded >= 1, "at least one grid upgrade (flatten or per-row)");
});
