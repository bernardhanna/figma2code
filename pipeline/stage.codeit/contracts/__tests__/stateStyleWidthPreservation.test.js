const test = require("node:test");
const assert = require("node:assert/strict");

const { apply: enforceWidth } = require("../layout/width/enforceWidthIntent");
const { apply: cleanup } = require("../layout/cleanup/previewNormalize");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

const runPipeline = (html) => {
  const step1 = enforceWidth({ html, artifact: {}, options: {} });
  const step2 = cleanup({ html: step1.html, artifact: {}, options: {} });
  return step2.html;
};

test("preserves hover state styles and fixed width intent", () => {
  const html = `
    <div data-key="card" class="bg-[#ededed] p-4 hover:bg-[#d9f1fc] hover:opacity-90 transition-opacity duration-200">
      <h3>Title</h3>
    </div>
    <div data-key="decorative" data-decorative="1" data-w-intent="fixed" data-w-rem="4.4375rem" class="w-full max-w-full h-[0.3125rem]"></div>
    <h2 data-key="heading" data-w-intent="fixed" data-w-rem="70rem" class="w-full max-w-full">Heading</h2>
  `;
  const out = runPipeline(html);
  const cardClass = getClass(out, "card");
  const barClass = getClass(out, "decorative");
  const headingClass = getClass(out, "heading");

  assert.ok(cardClass.includes("hover:bg-[#d9f1fc]"));
  assert.ok(cardClass.includes("hover:opacity-90"));
  assert.ok(cardClass.includes("transition-opacity"));
  assert.ok(cardClass.includes("duration-200"));

  assert.ok(barClass.includes("w-[4.4375rem]"));
  assert.ok(!barClass.includes("w-full"));
  assert.ok(!barClass.includes("max-w-full"));

  assert.ok(headingClass.includes("w-[70rem]"));
  assert.ok(!headingClass.includes("w-full"));
  assert.ok(!headingClass.includes("max-w-full"));
});
