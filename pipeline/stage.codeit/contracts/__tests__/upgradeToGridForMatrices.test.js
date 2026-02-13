const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/grid/upgradeToGridForMatrices");

test("2x2 matrix becomes single grid with 4 direct card children", () => {
  const html = `
    <div class="flex flex-col gap-[1.5rem] w-[70rem] max-w-full self-start">
      <div class="flex flex-col md:flex-row gap-[1.5rem] max-w-full self-start">
        <div class="flex-1 basis-0 min-w-0 p-4 bg-gray-100">Card 1</div>
        <div class="flex-1 basis-0 min-w-0 p-4 bg-gray-100">Card 2</div>
      </div>
      <div class="flex flex-col md:flex-row gap-[1.5rem] max-w-full self-start">
        <div class="flex-1 basis-0 min-w-0 p-4 bg-gray-100">Card 3</div>
        <div class="flex-1 basis-0 min-w-0 p-4 bg-gray-100">Card 4</div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("grid grid-cols-1"), "has grid");
  assert.ok(out.html.includes("md:grid-cols-2"), "has md:grid-cols-2");
  assert.ok(out.html.includes("gap-"), "has gap");
  assert.equal((out.html.match(/Card \d/g) || []).length, 4);
  assert.ok(!out.html.includes("flex flex-col md:flex-row"), "row wrappers removed");
  assert.equal(out.stats.upgraded, 1);
});

test("idempotent: already grid not upgraded again", () => {
  const html = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>A</div>
      <div>B</div>
      <div>C</div>
      <div>D</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.upgraded, 0);
});
