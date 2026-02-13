const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/fluidizeFixedRem");

const getClass = (html, dataKey) => {
  const str = String(html || "");
  // data-key before class
  let match = str.match(new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i"));
  if (match) return match[1].trim();
  // class before data-key
  match = str.match(new RegExp(`class="([^"]*)"[^>]*data-key="${dataKey}"`, "i"));
  return match ? match[1].trim() : "";
};

test("container with w-[70rem] and max-w-full becomes w-full without changing max widths", () => {
  const html = `
    <div data-key="container" class="w-[70rem] max-w-full px-4">Content</div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "container");
  assert.ok(cls.includes("w-full"), "should have w-full");
  assert.ok(cls.includes("max-w-full"), "max widths unchanged");
  assert.ok(!cls.includes("w-[70rem]"), "should remove w-[70rem]");
  assert.ok(out.stats.fluidized >= 1);
});

test("two card siblings with w-[34.25rem] and grow in flex-row parent get flex-1 and remain two columns at md+", () => {
  const html = `
    <div data-key="row" class="flex flex-row flex-wrap">
      <div data-key="card1" class="w-[34.25rem] grow basis-0 min-w-0 p-4">Card 1</div>
      <div data-key="card2" class="w-[34.25rem] grow basis-0 min-w-0 p-4">Card 2</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const card1 = getClass(out.html, "card1");
  const card2 = getClass(out.html, "card2");
  assert.ok(card1.includes("flex-1"), "card1 should have flex-1");
  assert.ok(card2.includes("flex-1"), "card2 should have flex-1");
  assert.ok(!card1.includes("w-[34.25rem]"), "fixed width removed");
  assert.ok(!card2.includes("w-[34.25rem]"), "fixed width removed");
  assert.ok(card1.includes("min-w-0"));
  assert.ok(card2.includes("min-w-0"));
});

test("two card siblings without flex-row parent get w-full md:w-1/2", () => {
  const html = `
    <div data-key="wrap" class="flex flex-col">
      <div data-key="a" class="w-[34.25rem] grow basis-0">A</div>
      <div data-key="b" class="w-[34.25rem] grow basis-0">B</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const a = getClass(out.html, "a");
  const b = getClass(out.html, "b");
  assert.ok(a.includes("w-full"), "should have w-full");
  assert.ok(a.includes("md:w-1/2"), "should have md:w-1/2");
  assert.ok(b.includes("w-full") && b.includes("md:w-1/2"));
  assert.ok(!a.includes("w-[34.25rem]"));
});

test("h3 with w-[20rem] gets max-w-[20rem] instead so heading wraps and does not overflow", () => {
  const html = `
    <div data-key="card">
      <h3 data-key="heading" class="w-[20rem] text-xl font-bold">Long heading text that should wrap</h3>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "heading");
  const tokens = cls.split(/\s+/);
  assert.ok(!tokens.includes("w-[20rem]"), "should remove w-[20rem] token");
  assert.ok(cls.includes("max-w-[20rem]"), "should add max-w-[20rem] for wrapping");
  assert.ok(out.stats.fluidized >= 1);
});

test("redundant breakpoint duplicate lg:w-[34.25rem] removed when base w-[34.25rem] exists", () => {
  const html = `
    <div data-key="el" class="w-[34.25rem] lg:w-[34.25rem] grow">X</div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "el");
  assert.ok(!cls.includes("lg:w-[34.25rem]"), "should remove redundant lg: width");
  assert.ok(cls.includes("flex-1") || cls.includes("w-full"), "fluid replacement present");
});

test("card inner wrapper with w-[30.25rem] max-w-full becomes w-full", () => {
  const html = `
    <div data-key="card" class="grow basis-0">
      <div data-key="inner" class="w-[30.25rem] max-w-full">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "inner");
  assert.ok(cls.includes("w-full"));
  assert.ok(!cls.includes("w-[30.25rem]"));
  assert.ok(cls.includes("max-w-[30.25rem]"));
});
