const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/innerWrapperFixedWidthToMax");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("card inner wrapper with w-[20rem] becomes w-full max-w-[20rem]", () => {
  const html = `
    <div class="grid grid-cols-1">
      <div data-key="wrap" class="w-[20rem]">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "wrap").split(/\s+/);
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-[20rem]"));
  assert.ok(!cls.includes("w-[20rem]"));
});

test("element with w-full w-[20rem] becomes w-full max-w-[20rem]", () => {
  const html = `
    <div class="flex">
      <div data-key="wrap2" class="w-full w-[20rem]">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "wrap2").split(/\s+/);
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-[20rem]"));
  assert.ok(!cls.includes("w-[20rem]"));
});

test("single-image media wrapper can be fluidized to w-full max-w-[X]", () => {
  const html = `
    <div class="flex">
      <div data-key="media" class="w-[20rem] overflow-hidden">
        <img src="x.jpg" />
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "media").split(/\s+/);
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-[20rem]"));
  assert.ok(!cls.includes("w-[20rem]"));
});

test("root container is untouched", () => {
  const html = `
    <div data-key="root" class="w-[20rem] max-w-[80rem] mx-auto"></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "root").split(/\s+/);
  assert.ok(cls.includes("w-[20rem]"));
});

test("horizontal scroll containers are untouched", () => {
  const html = `
    <div class="flex">
      <div data-key="scroll" class="w-[20rem] overflow-x-auto">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "scroll").split(/\s+/);
  assert.ok(cls.includes("w-[20rem]"));
});

test("absolutely positioned elements are untouched", () => {
  const html = `
    <div class="flex">
      <div data-key="abs" class="w-[20rem] absolute top-0">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "abs").split(/\s+/);
  assert.ok(cls.includes("w-[20rem]"));
});

test("decorative descendants are not width-canonicalized", () => {
  const html = `
    <div data-decorative="1" class="flex w-[4.4375rem] h-[0.3125rem]">
      <div data-key="seg" class="grow basis-0 min-w-0 h-[0.3125rem] w-[1.109375rem] bg-[#ef7b10]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "seg").split(/\s+/);
  assert.ok(cls.includes("w-[1.109375rem]"));
  assert.ok(!cls.includes("w-full"));
  assert.ok(!cls.includes("max-w-[1.109375rem]"));
});
