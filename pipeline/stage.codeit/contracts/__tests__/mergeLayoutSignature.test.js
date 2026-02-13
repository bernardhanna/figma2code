const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/wrappers/mergeLayoutSignature");

test("merges redundant nested wrappers with same layout signature", () => {
  const html = `
    <div class="flex flex-col gap-4 w-full">
      <div class="flex flex-col gap-4 w-full">
        <h2>Title</h2>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const count = (out.html.match(/flex flex-col gap-4 w-full/g) || []).length;
  assert.equal(count, 1, "one wrapper should remain");
});

test("does not merge when data-key is non-instance", () => {
  const html = `
    <div data-key="hero" class="flex flex-col gap-4 w-full">
      <div class="flex flex-col gap-4 w-full">
        <h2>Title</h2>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const count = (out.html.match(/flex flex-col gap-4 w-full/g) || []).length;
  assert.equal(count, 2, "no merge when data-key is non-instance");
});
