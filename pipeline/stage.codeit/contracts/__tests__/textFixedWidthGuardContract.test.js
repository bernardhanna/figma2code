const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/text/textFixedWidthGuardContract");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("paragraph with w-[70rem] becomes responsive width constraint", () => {
  const html = `<p data-key="p" class="text-left w-[70rem]">Text</p>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "p");
  const tokens = cls.split(/\s+/);
  assert.ok(!tokens.includes("w-[70rem]"));
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("max-w-[70rem]"));
  assert.ok(tokens.includes("max-w-full"));
});

test("heading with w-[70rem] becomes responsive width constraint", () => {
  const html = `<h2 data-key="h" class="text-left w-[70rem]">Heading</h2>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "h");
  const tokens = cls.split(/\s+/);
  assert.ok(!tokens.includes("w-[70rem]"));
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("max-w-[70rem]"));
  assert.ok(tokens.includes("max-w-full"));
});

test("node inside overflow-x-auto context is unchanged", () => {
  const html = `
    <div class="overflow-x-auto">
      <p data-key="p2" class="w-[70rem]">Text</p>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "p2");
  const tokens = cls.split(/\s+/);
  assert.ok(tokens.includes("w-[70rem]"));
  assert.ok(!tokens.includes("max-w-[70rem]"));
});

test("span direct child of text block is adjusted", () => {
  const html = `
    <p>
      <span data-key="s" class="w-[30rem]">Text</span>
    </p>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "s");
  const tokens = cls.split(/\s+/);
  assert.ok(!tokens.includes("w-[30rem]"));
  assert.ok(tokens.includes("max-w-[30rem]"));
});
