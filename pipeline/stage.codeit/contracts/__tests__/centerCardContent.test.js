const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/align/centerCardContent");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("adds items-center to card containers when md:items-center and text-center present", () => {
  const html = `
    <div data-key="card" class="bg-[#eee] p-4 md:items-center justify-center flex flex-col">
      <h3 class="text-center">Title</h3>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "card");
  assert.ok(cls.includes("items-center"));
  assert.equal(out.stats.added, 1);
});

test("does not add items-center when base items-start exists", () => {
  const html = `
    <div data-key="card" class="bg-[#eee] p-4 items-start md:items-center">
      <h3 class="text-center">Title</h3>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "card");
  assert.ok(cls.includes("items-start"));
  assert.ok(!cls.includes("items-center items-center"));
});
