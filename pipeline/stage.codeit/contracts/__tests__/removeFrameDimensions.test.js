const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/root/removeFrameDimensions");

const getClassList = (html, tag) => {
  const match = String(html || "").match(new RegExp(`<${tag}[^>]*class="([^"]*)"`, "i"));
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
};

test("root with w-[80rem] h-[40rem] becomes w-full with no height", () => {
  const html = `<section data-key="root" data-w-intent="fixed" class="w-[80rem] h-[40rem]">
  <div class="flex">Content</div>
</section>`;
  const out = apply({ html });
  const rootClasses = getClassList(out.html, "section");
  assert.ok(!rootClasses.includes("w-[80rem]"), "w-[80rem] removed from root");
  assert.ok(!rootClasses.includes("h-[40rem]"), "h-[40rem] removed from root");
  assert.ok(rootClasses.includes("w-full"), "w-full enforced");
});

test("root with w-60 becomes w-full", () => {
  const html = `<header data-w-intent="hug" class="w-60">
  <div class="grid">Content</div>
</header>`;
  const out = apply({ html });
  const rootClasses = getClassList(out.html, "header");
  assert.ok(!rootClasses.includes("w-60"), "w-60 removed from root");
  assert.ok(rootClasses.includes("w-full"), "w-full enforced");
});

test("image with w-[28rem] remains unchanged", () => {
  const html = `<section data-w-intent="fixed" class="w-[80rem]">
  <div class="flex">
    <img src="/hero.jpg" alt="Hero" class="w-[28rem] object-cover" />
  </div>
</section>`;
  const out = apply({ html });
  assert.ok(out.html.includes("w-[28rem]"), "image width unchanged");
});

test("decorative bar heights remain untouched", () => {
  const html = `<section data-w-intent="fixed" class="w-[80rem]">
  <div class="flex">Content</div>
  <div data-decorative="1" class="flex h-[0.3125rem] w-[4.4375rem]">
    <span class="grow h-[0.3125rem] bg-[#ef7b10]"></span>
  </div>
</section>`;
  const out = apply({ html });
  assert.ok(out.html.includes('data-decorative="1"'), "decorative bar preserved");
  assert.ok(out.html.includes("h-[0.3125rem]"), "decorative height preserved");
});

test("idempotence: running twice yields identical output", () => {
  const html = `<section data-key="root" data-w-intent="fixed" class="w-[80rem] h-[40rem]">
  <div class="flex">Content</div>
</section>`;
  const first = apply({ html });
  const second = apply({ html: first.html });
  assert.equal(second.html, first.html, "second run output equals first run output");
  assert.equal(second.stats.adjusted, 0, "no changes on second run");
});

test("hero/banner roots keep intentional fixed height", () => {
  const html = `<section role="banner" data-bg-type="video" data-key="hero-root" data-w-intent="fixed" class="w-[80rem] h-[41.5625rem]">
  <div class="flex">Content</div>
</section>`;
  const out = apply({ html });
  const rootClasses = getClassList(out.html, "section");
  assert.ok(rootClasses.includes("h-[41.5625rem]"), "hero height preserved");
  assert.ok(rootClasses.includes("w-[80rem]"), "explicit media wrapper width remains untouched");
});
