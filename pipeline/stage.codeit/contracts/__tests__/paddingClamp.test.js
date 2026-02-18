const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/spacing/paddingClamp");

const getClassByKey = (html, key) => {
  const match = String(html || "").match(new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i"));
  return match ? match[1] : "";
};

test("reinterprets suspicious non-hero rem padding as px-derived rem", () => {
  const html = `<section data-key="root" class="flex"><div data-key="content" class="pt-[2.5rem] md:pt-[20rem] md:pb-[20rem]">X</div></section>`;
  const out = apply({ html });
  const cls = getClassByKey(out.html, "content");
  assert.ok(cls.includes("md:pt-[1.25rem]"), "20rem should normalize to 1.25rem");
  assert.ok(cls.includes("md:pb-[1.25rem]"), "20rem should normalize to 1.25rem");
  assert.ok(!cls.includes("md:pt-[20rem]"));
});

test("does not clamp hero/banner padding values", () => {
  const html = `<section role="banner" data-key="hero-root" class="md:pt-[20rem] md:pb-[20rem]">X</section>`;
  const out = apply({ html });
  assert.ok(out.html.includes("md:pt-[20rem]"));
  assert.ok(out.html.includes("md:pb-[20rem]"));
});
