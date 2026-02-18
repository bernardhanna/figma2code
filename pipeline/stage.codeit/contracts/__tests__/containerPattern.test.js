const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/section/containerPattern");

const getClassList = (html, tag) => {
  const match = String(html || "").match(new RegExp(`<${tag}[^>]*class="([^"]*)"`, "i"));
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
};

test("section root with padding adds inner container", () => {
  const html = `<section data-key="root" class="w-full pt-8 pb-8 bg-gray-100">
  <div class="flex max-w-[70rem]">Content</div>
</section>`;
  const out = apply({ html });
  assert.ok(
    /<section[^>]*>\s*<div[^>]*class="[^"]*w-full[^"]*mx-auto[^"]*max-w-\[70rem\][^"]*"/i.test(
      out.html
    ),
    "inner container inserted with w-full mx-auto max-w"
  );
  const sectionClasses = getClassList(out.html, "section");
  assert.ok(sectionClasses.includes("pt-8"), "section padding preserved");
  assert.ok(sectionClasses.includes("bg-gray-100"), "section background preserved");
  assert.ok(sectionClasses.includes("w-full"), "section remains w-full");
});

test("multi-column grid removes card max-w and centering", () => {
  const html = `<section data-key="root" class="pt-8 bg-white">
  <div class="grid md:grid-cols-3 gap-4">
    <div class="w-full max-w-[20rem] self-center">Card</div>
    <div class="w-full max-w-[22rem] self-center">Card</div>
  </div>
</section>`;
  const out = apply({ html });
  const cardTags = out.html.match(/<div[^>]*>Card<\/div>/g) || [];
  assert.ok(cardTags.length >= 2, "cards present");
  cardTags.forEach((tag) => {
    assert.ok(!tag.includes("max-w-["), "card max-w removed");
    assert.ok(!tag.includes("self-center"), "card centering removed");
  });
});

test("decorative bar and h2 max-w remain unchanged", () => {
  const html = `<section data-key="root" class="pt-8 bg-white">
  <div class="flex flex-col">
    <h2 class="max-w-[40rem] text-2xl">Title</h2>
    <div data-decorative="1" class="h-[0.3125rem] w-[4.4375rem]"></div>
  </div>
</section>`;
  const out = apply({ html });
  const h2Classes = getClassList(out.html, "h2");
  assert.ok(h2Classes.includes("max-w-[40rem]"), "h2 max-w preserved");
  const decorativeTag = out.html.match(/<div\s+data-decorative="1"[^>]*>/)?.[0] ?? "";
  assert.ok(decorativeTag.includes("h-[0.3125rem]"), "decorative height preserved");
  assert.ok(decorativeTag.includes("w-[4.4375rem]"), "decorative width preserved");
});

test("idempotent: running twice makes no further changes", () => {
  const html = `<section data-key="root" class="w-full pt-8 pb-8 bg-gray-100">
  <div class="flex max-w-[70rem]">Content</div>
</section>`;
  const first = apply({ html });
  const second = apply({ html: first.html });
  assert.equal(second.html, first.html, "second run output equals first run output");
  assert.equal(second.stats.wrapped, 0, "no new wraps on second run");
});
