const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/widthRedundancyCollapseContract");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("parent max-w, child max-w same -> remove child", () => {
  const html = `
    <div class="w-full max-w-[20rem]">
      <div data-key="child" class="max-w-[20rem]">X</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "child");
  assert.ok(!cls.includes("max-w-[20rem]"));
});

test("parent md:max-w, child md:max-w same -> remove child md", () => {
  const html = `
    <div class="md:max-w-[20rem]">
      <div data-key="child" class="md:max-w-[20rem]">X</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "child");
  assert.ok(!cls.includes("md:max-w-[20rem]"));
});

test("parent max-w, child md:max-w -> keep child", () => {
  const html = `
    <div class="max-w-[20rem]">
      <div data-key="child" class="md:max-w-[20rem]">X</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "child");
  assert.ok(cls.includes("md:max-w-[20rem]"));
});

test("parent max-w, child max-w-full -> remove child max-w-full", () => {
  const html = `
    <div class="max-w-[20rem]">
      <div data-key="child" class="max-w-full">X</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "child");
  assert.ok(!cls.includes("max-w-full"));
});

test("media wrapper retains width classes", () => {
  const html = `
    <div class="max-w-[20rem]">
      <div data-key="child" class="max-w-[20rem] overflow-hidden">
        <img src="x.jpg" />
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "child");
  assert.ok(cls.includes("max-w-[20rem]"));
});
