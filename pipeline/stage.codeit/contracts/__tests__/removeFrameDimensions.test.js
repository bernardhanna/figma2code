const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/root/removeFrameDimensions");

test("root wrapper: removes w-[80rem] and h-[40rem] from section root, keeps w-full and max-w-[80rem]", () => {
  const html = `
<section data-key="root" class="flex flex-col md:flex-row gap-[3rem] pt-[2.5rem] md:pt-[5rem] pb-[2.5rem] md:pb-[5rem] pr-[5rem] pl-[5rem] max-xl:px-5 bg-[#ededed] bg-center h-[40rem] w-[80rem]">
  <div class="w-full max-w-[28.75rem]">Left</div>
  <div class="w-full max-w-[38.25rem]">Right</div>
</section>`;
  const out = apply({ html });
  assert.ok(!out.html.includes("w-[80rem]"), "base w-[80rem] removed");
  assert.ok(!out.html.includes("h-[40rem]"), "base h-[40rem] removed");
  assert.ok(out.html.includes("w-full"), "w-full present");
  assert.ok(out.html.includes("max-w-[28.75rem]") || out.html.includes("max-w-[38.25rem]"), "max-w preserved on children");
  assert.ok(out.html.includes('data-key="root"'), "data-key unchanged");
  assert.equal(out.stats.removed, 2);
});

test("paragraph/text blocks: remove fixed width w-[70rem], keep w-full max-w-[70rem]", () => {
  const html = `
<div class="w-full max-w-[80rem] mx-auto">
  <p class="break-words text-left text-[1rem] w-[70rem] max-w-[70rem] font-['Montserrat']">At Paul Tobin Estate Agents we specialise.</p>
</div>`;
  const out = apply({ html });
  const pClassMatch = out.html.match(/<p[^>]*class="([^"]*)"/);
  assert.ok(pClassMatch, "p element found");
  const classTokens = pClassMatch[1].split(/\s+/).filter(Boolean);
  assert.ok(!classTokens.includes("w-[70rem]"), "fixed w-[70rem] token removed from p");
  assert.ok(classTokens.includes("max-w-[70rem]"), "max-w-[70rem] kept");
  assert.ok(classTokens.includes("w-full"), "w-full added when removing w-[70rem]");
});

test("media wrapper: keep h-[30rem] and sizing on image wrappers and img", () => {
  const html = `
<div data-key="frame:imagegrid2#1" class="flex flex-col w-full max-w-[28.75rem] h-[30rem] grow basis-0 min-w-0">
  <img src="/assets/rect.png" alt="Rect" class="basis-[28.75rem] shrink-0 h-[30rem] object-cover" />
</div>`;
  const out = apply({ html });
  assert.ok(out.html.includes("h-[30rem]"), "h-[30rem] kept on media wrapper and img");
  assert.ok(out.html.includes("max-w-[28.75rem]"), "max-w kept");
  assert.equal(out.stats.removed, 0);
});

test("decorative bars/dividers: keep explicit small widths and heights on bar wrappers", () => {
  const html = `
<div data-decorative="1" class="flex flex-row h-[0.3125rem] w-[4.4375rem]">
  <div class="grow basis-0 h-[0.3125rem] bg-[#ef7b10]"></div>
</div>
<div data-key="frame:text#1/instance:h2#1/frame:h2#1/instance:decorativebarhorizontal#1" class="flex h-[0.3125rem] w-[4.4375rem]">
  <div class="w-full h-[0.3125rem] bg-[#0098d8]"></div>
</div>`;
  const out = apply({ html });
  assert.ok(out.html.includes("h-[0.3125rem]"), "decorative bar height kept");
  assert.ok(out.html.includes("w-[4.4375rem]"), "decorative bar width kept");
  assert.ok(out.html.includes('data-decorative="1"'), "data-decorative bar wrapper unchanged");
  assert.ok(out.html.includes("decorativebarhorizontal"), "data-key decorative bar wrapper unchanged");
});

test("responsive: md:w-[...] and md:h-[...] remain when base w-[...]/h-[...] removed", () => {
  const html = `
<section class="flex flex-col md:flex-row w-[80rem] md:w-[70rem] h-[40rem] md:h-[35rem] gap-4 bg-gray-100">
  <div>Content</div>
</section>`;
  const out = apply({ html });
  assert.ok(!out.html.includes("w-[80rem]"), "base w-[80rem] removed");
  assert.ok(!out.html.includes("h-[40rem]"), "base h-[40rem] removed");
  assert.ok(out.html.includes("md:w-[70rem]"), "md:w-[70rem] kept");
  assert.ok(out.html.includes("md:h-[35rem]"), "md:h-[35rem] kept");
  assert.ok(out.html.includes("w-full"), "w-full added");
  assert.equal(out.stats.removed, 2);
});
