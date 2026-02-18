const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/section/enforceMobileVerticalPadding");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("root section gets base 2.5rem and md restores original", () => {
  const html = `
    <section data-key="root" class="flex flex-col pt-[5rem] pb-[5rem] px-[5rem]"></section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root");
  const tokens = cls.split(/\s+/);
  assert.ok(tokens.includes("pt-[2.5rem]"));
  assert.ok(tokens.includes("pb-[2.5rem]"));
  assert.ok(tokens.includes("md:pt-[5rem]"));
  assert.ok(tokens.includes("md:pb-[5rem]"));
  assert.ok(tokens.includes("px-[5rem]"));
});

test("only pt transforms when pb is missing", () => {
  const html = `
    <section data-key="root" class="pt-[3rem] px-4"></section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root");
  const tokens = cls.split(/\s+/);
  assert.ok(tokens.includes("pt-[2.5rem]"));
  assert.ok(tokens.includes("md:pt-[3rem]"));
  assert.ok(!tokens.includes("pb-[2.5rem]"));
});

test("no change when base is already 2.5rem", () => {
  const html = `
    <section data-key="root" class="pt-[2.5rem] pb-[2.5rem]"></section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root");
  assert.ok(cls.includes("pt-[2.5rem]"));
  assert.ok(cls.includes("pb-[2.5rem]"));
  assert.ok(!cls.includes("md:pt-"));
  assert.ok(!cls.includes("md:pb-"));
});

test("non-root section is untouched", () => {
  const html = `
    <div>
      <section class="pt-[5rem] pb-[5rem]"></section>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("pt-[5rem]"));
  assert.ok(!out.html.includes("pt-[2.5rem]"));
});
