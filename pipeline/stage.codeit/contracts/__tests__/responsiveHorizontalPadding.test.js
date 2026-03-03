const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/section/responsiveHorizontalPadding");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("root with pl-20 pr-20 becomes px-5 md:px-20", () => {
  const html = `
    <section data-key="root" class="flex pl-20 pr-20 w-full max-w-[80rem] mx-auto"></section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(!cls.includes("pl-20"));
  assert.ok(!cls.includes("pr-20"));
  assert.ok(cls.includes("px-5"));
  assert.ok(cls.includes("md:px-20"));
  assert.ok(cls.includes("max-xl:px-5"));
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-[80rem]"));
});

test("equivalent fixed rem pair becomes px-5 md:px-20", () => {
  const html = `
    <div data-key="root" data-w-rem="80rem" class="pl-[5rem] pr-[5rem] flex"></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(!cls.includes("pl-[5rem]"));
  assert.ok(!cls.includes("pr-[5rem]"));
  assert.ok(cls.includes("px-5"));
  assert.ok(cls.includes("md:px-20"));
  assert.ok(cls.includes("max-xl:px-5"));
});

test("existing md horizontal padding is preserved and only base normalizes", () => {
  const html = `
    <section data-key="root" class="px-20 md:px-16 w-full max-w-[80rem]"></section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(!cls.includes("px-20"));
  assert.ok(cls.includes("px-5"));
  assert.ok(cls.includes("md:px-16"));
  assert.ok(!cls.includes("md:px-20"));
  assert.ok(cls.includes("max-xl:px-5"));
});

test("non-root node without container context is untouched", () => {
  const html = `
    <div><div data-key="inner" class="pl-20 pr-20 flex"></div></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "inner").split(/\s+/);
  assert.ok(cls.includes("pl-20"));
  assert.ok(cls.includes("pr-20"));
  assert.ok(!cls.includes("px-5"));
});

test("node with md:pl/md:pr pair keeps md pair and adds max-xl guard", () => {
  const html = `
    <section data-key="root" class="pl-20 pr-20 md:pl-20 md:pr-20"></section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(cls.includes("pl-20"));
  assert.ok(cls.includes("pr-20"));
  assert.ok(cls.includes("md:pl-20"));
  assert.ok(cls.includes("md:pr-20"));
  assert.ok(!cls.includes("px-5"));
  assert.ok(cls.includes("max-xl:px-5"));
});

test("narrow frame removes lg horizontal padding compensation", () => {
  const html = `
    <div data-key="root" data-w-rem="68rem" class="pl-5 pr-5 lg:pl-24 lg:pr-24 flex"></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(!cls.includes("lg:pl-24"));
  assert.ok(!cls.includes("lg:pr-24"));
  assert.ok(cls.includes("pl-5"));
  assert.ok(cls.includes("pr-5"));
});

test("uses ancestor max-w as effective frame width for lg trim", () => {
  const html = `
    <section class="w-full max-w-[70rem] mx-auto">
      <div data-key="root" data-w-rem="80rem" class="pl-5 pr-5 lg:pl-20 lg:pr-20 flex"></div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(!cls.includes("lg:pl-20"));
  assert.ok(!cls.includes("lg:pr-20"));
  assert.ok(cls.includes("pl-5"));
  assert.ok(cls.includes("pr-5"));
});

