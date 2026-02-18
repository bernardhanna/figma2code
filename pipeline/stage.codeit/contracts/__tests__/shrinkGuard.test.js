const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/text/shrinkGuard");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("removes shrink-0 from wrapping heading", () => {
  const html = `
    <h3 data-key="title" class="break-words shrink-0">Title</h3>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "title");
  assert.ok(!cls.includes("shrink-0"));
});

test("keeps shrink-0 for nowrap label in flex-row", () => {
  const html = `
    <div class="flex flex-row">
      <span data-key="label" class="whitespace-nowrap shrink-0">Label</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "label");
  assert.ok(cls.includes("shrink-0"));
});
