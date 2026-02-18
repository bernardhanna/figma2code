const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/text/nowrapGuard");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("removes nowrap from constrained heading", () => {
  const html = `
    <h3 data-key="title" class="w-[20rem] whitespace-nowrap">Title</h3>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "title");
  assert.ok(!cls.includes("whitespace-nowrap"));
  assert.equal(out.stats.removed, 1);
});

test("removes nowrap from card container", () => {
  const html = `
    <div data-key="card" class="bg-[#eee] p-4 whitespace-nowrap">
      <p>Text</p>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "card");
  assert.ok(!cls.includes("whitespace-nowrap"));
});

test("keeps nowrap on badge-like label", () => {
  const html = `
    <span data-key="badge" class="inline-flex px-2 py-1 rounded-full whitespace-nowrap">NEW</span>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "badge");
  assert.ok(cls.includes("whitespace-nowrap"));
});
