const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/cleanup/previewNormalize");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

test("collapses redundant nested wrappers around heading block", () => {
  const html = `
    <div data-key="instance:h2#1" class="flex flex-col gap-4 w-full max-w-full">
      <div data-key="instance:h2#1/frame:h2#1" class="flex flex-col gap-4 w-full max-w-full">
        <h2>Title</h2>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const hasOuter = out.html.includes('data-key="instance:h2#1"');
  const hasInner = out.html.includes('data-key="instance:h2#1/frame:h2#1"');
  assert.ok(hasOuter || hasInner, "one wrapper remains");
  assert.ok(!(hasOuter && hasInner), "one wrapper removed");
  assert.equal(out.stats.merged, 1);
});

test("preserves hover/transition classes on card container", () => {
  const html = `
    <div data-key="card" class="bg-[#ededed] p-4 hover:bg-[#d9f1fc] hover:opacity-90 transition-opacity duration-200">
      <div class="flex flex-col gap-2">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "card");
  assert.ok(cls.includes("hover:bg-[#d9f1fc]"));
  assert.ok(cls.includes("hover:opacity-90"));
  assert.ok(cls.includes("transition-opacity"));
  assert.ok(cls.includes("duration-200"));
});

test("dedupes items-center md:items-center and w-full md:w-full", () => {
  const html = `<div data-key="x" class="items-center md:items-center w-full md:w-full"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "x");
  assert.ok(cls.includes("items-center"));
  assert.ok(!cls.includes("md:items-center"));
  assert.ok(cls.includes("w-full"));
  assert.ok(!cls.includes("md:w-full"));
});

test("removes max-w-full when specific max-w exists", () => {
  const html = `<div data-key="y" class="w-full max-w-full max-w-[70rem]"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "y");
  assert.ok(cls.includes("max-w-[70rem]"));
  assert.ok(!cls.includes("max-w-full"));
});

test("idempotent: running twice yields same output", () => {
  const html = `<div class="items-center md:items-center"></div>`;
  const first = apply({ html, artifact: {}, options: {} });
  const second = apply({ html: first.html, artifact: {}, options: {} });
  assert.equal(first.html, second.html);
});

test("does not collapse centered container wrappers into children", () => {
  const html = `
    <div data-key="root" class="w-full max-w-[80rem] mx-auto">
      <div data-key="card" class="flex flex-col gap-6 w-[26rem] self-start">Card</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes('data-key="root"'), "container wrapper preserved");
  assert.ok(out.html.includes('data-key="card"'), "child remains intact");
  assert.ok(out.stats.merged === 0, "no wrapper collapse should happen");
});
