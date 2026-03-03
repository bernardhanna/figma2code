const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/cards/normalizeRepeatingCardText");

const getClass = (html, dataKey) => {
  const m =
    String(html || "").match(new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i")) ||
    String(html || "").match(new RegExp(`class="([^"]*)"[^>]*data-key="${dataKey}"`, "i"));
  return m ? m[1] : "";
};

test("normalizes repeated item text classes only when structure exactly matches", () => {
  const html = `
    <div data-key="frame:4-items#1" class="flex">
      <div data-key="frame:4-items#1/frame:item#1" class="flex">
        <div data-key="frame:4-items#1/frame:item#1/frame:name#1" class="flex flex-col gap-1 self-start">
          <p data-key="frame:4-items#1/frame:item#1/frame:name#1/text:a#1" class="text-[1.125rem] font-[700]">A</p>
          <p data-key="frame:4-items#1/frame:item#1/frame:name#1/text:b#1" class="text-[0.875rem] font-[400]">B</p>
        </div>
      </div>
      <div data-key="frame:4-items#1/frame:item#2" class="flex">
        <div data-key="frame:4-items#1/frame:item#2/frame:name#1" class="flex flex-col gap-3 self-start">
          <p data-key="frame:4-items#1/frame:item#2/frame:name#1/text:c#1" class="text-[1rem] font-[600]">C</p>
          <p data-key="frame:4-items#1/frame:item#2/frame:name#1/text:d#1" class="text-[0.75rem] font-[300]">D</p>
        </div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.stats.normalized > 0);
  const wrapper = getClass(out.html, "frame:4-items#1/frame:item#2/frame:name#1");
  assert.ok(wrapper.includes("gap-1"));
  const title = getClass(out.html, "frame:4-items#1/frame:item#2/frame:name#1/text:c#1");
  assert.ok(title.includes("text-[1.125rem]"));
  assert.ok(title.includes("font-[700]"));
});

test("does nothing when repeated item text structures differ", () => {
  const html = `
    <div data-key="frame:4-items#1" class="flex">
      <div data-key="frame:4-items#1/frame:item#1" class="flex">
        <div data-key="frame:4-items#1/frame:item#1/frame:name#1" class="flex flex-col">
          <p data-key="frame:4-items#1/frame:item#1/frame:name#1/text:a#1" class="x">A</p>
          <p data-key="frame:4-items#1/frame:item#1/frame:name#1/text:b#1" class="y">B</p>
        </div>
      </div>
      <div data-key="frame:4-items#1/frame:item#2" class="flex">
        <div data-key="frame:4-items#1/frame:item#2/frame:name#1" class="flex flex-col">
          <div><p data-key="frame:4-items#1/frame:item#2/frame:name#1/text:c#1" class="z">C</p></div>
        </div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
});

