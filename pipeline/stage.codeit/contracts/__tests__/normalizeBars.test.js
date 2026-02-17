const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/underline/normalizeBars");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

const getClassByIndex = (html, tag, index = 0) => {
  const regex = new RegExp(`<${tag}[^>]*class="([^"]*)"`, "gi");
  let m;
  let i = 0;
  while ((m = regex.exec(html)) !== null) {
    if (i === index) return m[1].trim();
    i += 1;
  }
  return "";
};

test("node with h-[0.625rem] pb-[1.5rem] border-[0.5rem] border-[rgba(...)] becomes filled bar with no padding", () => {
  const html = `
    <div data-key="heading-block">
      <h2>Title</h2>
      <div data-key="underline-bar" class="h-[0.625rem] pb-[1.5rem] border-[0.5rem] border-[rgba(0,152,216,0.8)] w-[6.25rem]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "underline-bar");
  assert.ok(barClass.includes("w-[100px]"), "should have w-[100px]");
  assert.ok(barClass.includes("h-[10px]"), "should be filled bar height");
  assert.ok(barClass.includes("bg-"), "should be filled bar color");
  assert.ok(!barClass.includes("pb-"), "no padding on bar");
  assert.equal(out.stats.normalized, 1);
});

test("node with w-[100px] h-[10px] bg-[#0098d8] remains filled", () => {
  const html = `
    <div>
      <h2>Title</h2>
      <div data-key="bar" class="w-[100px] h-[10px] bg-[#0098d8]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "bar");
  assert.ok(barClass.includes("w-[100px]"));
  assert.ok(barClass.includes("h-[10px]"));
  assert.ok(barClass.includes("bg-[#0098d8]"));
  assert.equal(out.stats.normalized, 0);
});

test("leaves already correct bar w-[100px] h-[10px] bg-[#...] unchanged in form", () => {
  const html = `
    <div>
      <h1>Heading</h1>
      <div data-key="bar" class="w-[100px] h-[10px] bg-[#000000]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "bar");
  assert.ok(barClass.includes("w-[100px]"));
  assert.ok(barClass.includes("h-[10px]"));
  assert.ok(barClass.includes("bg-[#000000]"));
  assert.equal(out.stats.normalized, 0);
});

test("does not change non-bar divider elsewhere", () => {
  const html = `
    <section>
      <div data-key="section-divider" class="w-full h-px bg-gray-200 my-8"></div>
      <p>Content</p>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const dividerClass = getClass(out.html, "section-divider");
  assert.ok(dividerClass.includes("w-full"));
  assert.ok(dividerClass.includes("h-px"));
  assert.ok(dividerClass.includes("bg-gray-200"));
  assert.equal(out.stats.normalized, 0);
});

test("normalizes bar even when not under heading (e.g. card underline)", () => {
  const html = `
    <div>
      <div data-key="card-bar" class="pb-[1.5rem] border-[0.5rem] w-[6.25rem] h-[0.625rem] border-[rgba(0,152,216,1)]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "card-bar");
  assert.ok(barClass.includes("w-[100px]"));
  assert.ok(!barClass.includes("pb-"));
  assert.ok(barClass.includes("h-[10px]") && barClass.includes("bg-"), "filled form");
  assert.equal(out.stats.normalized, 1);
});

test("normalizes bar that immediately follows h2 (sibling)", () => {
  const html = `
    <div>
      <h2>Title</h2>
      <div data-key="bar2" class="w-[6.25rem] h-[0.625rem] pb-6 border-[0.5rem] bg-[#111]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "bar2");
  assert.ok(barClass.includes("w-[100px]"));
  assert.ok(!barClass.includes("pb-6"));
  assert.ok(barClass.includes("h-[10px]") && barClass.includes("bg-"), "filled form");
  assert.equal(out.stats.normalized, 1);
});

test("strips layout/container classes from bar and enforces width", () => {
  const html = `
    <div>
      <div data-key="bar3" class="flex flex-col md:flex-row md:justify-center md:items-center max-w-full whitespace-nowrap gap-2 border-[0.5rem] border-[rgba(0,0,0,0.6)] h-[0.625rem]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "bar3");
  assert.ok(barClass.includes("w-[100px]"), "enforces w-[100px]");
  assert.ok(!barClass.includes("flex"), "removes flex");
  assert.ok(!barClass.includes("grid"), "removes grid");
  assert.ok(!barClass.includes("justify-"), "removes justify");
  assert.ok(!barClass.includes("items-"), "removes items");
  assert.ok(!barClass.includes("gap-"), "removes gap");
  assert.ok(!barClass.includes("whitespace-nowrap"), "removes whitespace-nowrap");
  assert.ok(barClass.includes("h-[10px]") && barClass.includes("bg-"), "canonical filled bar output");
});

test("stroke-only hint keeps border-b style", () => {
  const html = `
    <div>
      <div data-key="underline-stroke" data-underline-style="stroke" class="border-[0.5rem] border-[rgba(0,0,0,0.6)] w-[6.25rem] h-[0.625rem]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "underline-stroke");
  assert.ok(barClass.includes("w-[100px]"));
  assert.ok(barClass.includes("border-b-"));
  assert.ok(!barClass.includes("bg-"));
});

test("uses data-w-rem for bar width when present", () => {
  const html = `
    <div data-key="bar4" data-w-rem="6.25rem" class="h-[0.625rem] pb-[1.5rem] border-[0.5rem] border-[rgba(0,0,0,0.6)]"></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const barClass = getClass(out.html, "bar4");
  assert.ok(barClass.includes("w-[6.25rem]"), "uses w-[6.25rem] from data-w-rem");
  assert.ok(barClass.includes("h-[10px]") && barClass.includes("bg-"), "filled bar output");
});

test("skips decorative multi-rect bar segments", () => {
  const html = `
    <div data-key="decorativebarhorizontal" data-decorative="1" class="flex w-[4.4375rem] h-[0.3125rem]">
      <div data-key="segment" class="grow basis-0 h-[0.3125rem] bg-[#ef7b10]"></div>
      <div data-key="segment" class="grow basis-0 h-[0.3125rem] bg-[#0098d8]"></div>
      <div data-key="segment" class="grow basis-0 h-[0.3125rem] bg-[#b6c0cb]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("h-[0.3125rem]"), "segment height preserved");
  assert.ok(!out.html.includes("w-[100px] h-[10px]"), "segments not normalized to 100px bars");
});

test("decorative multi-rect bar container gets explicit width from data-w-rem", () => {
  const html = `
    <div data-key="decorativebarhorizontal" data-decorative="1" data-w-rem="4.4375rem" class="flex h-[0.3125rem] self-start">
      <div class="grow basis-0 h-[0.3125rem] bg-[#ef7b10]"></div>
      <div class="grow basis-0 h-[0.3125rem] bg-[#0098d8]"></div>
      <div class="grow basis-0 h-[0.3125rem] bg-[#b6c0cb]"></div>
      <div class="grow basis-0 h-[0.3125rem] bg-[#74af27]"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes('class="flex h-[0.3125rem] self-start w-[4.4375rem]"'));
});
