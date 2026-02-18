const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { apply } = require("../layout/width/enforceWidthIntent");

const getAttr = (html, attr) => {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1] : "";
};
const getClassByKey = (html, key) => {
  const regex = new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1] : "";
};

const thumbsFixturePath = path.resolve(
  process.cwd(),
  "pipeline/stage.codeit/contracts/__tests__/fixtures/thumbs1CtaWidth.fixture.html"
);

test("fixed intent with no width becomes fill with w-full max-w-full", () => {
  const html = `<div data-w-intent="fixed" class="flex flex-col"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  const intent = getAttr(out.html, "data-w-intent");
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-full"));
  assert.equal(intent, "fill");
  assert.equal(out.stats.enforced, 1);
});

test("fixed intent with data-w-rem on decorative keeps fixed width", () => {
  const html = `<div data-w-intent="fixed" data-w-rem="4.4375rem" data-decorative="1" class="flex"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  const intent = getAttr(out.html, "data-w-intent");
  assert.ok(cls.includes("w-[4.4375rem]"));
  assert.equal(intent, "fixed");
});

test("fixed intent on text uses w-[rem] and preserves fixed intent", () => {
  const html = `<h2 data-w-intent="fixed" data-w-rem="70rem" class="w-full max-w-full"></h2>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  const intent = getAttr(out.html, "data-w-intent");
  assert.ok(cls.includes("w-[70rem]"));
  assert.ok(!cls.includes("w-full"));
  assert.ok(!cls.includes("max-w-full"));
  assert.equal(intent, "fixed");
});

test("fixed intent on media is allowed exception", () => {
  const html = `<img data-w-intent="fixed" class="" />`;
  const out = apply({ html, artifact: {}, options: {} });
  const intent = getAttr(out.html, "data-w-intent");
  assert.equal(intent, "fixed");
  assert.equal(out.stats.enforced, 0);
});

test("fixed intent on wide wrapper is propagated as mobile-safe base + md fixed width", () => {
  const html = `<div data-w-intent="fixed" data-w-rem="32rem" class="flex w-[32rem]"></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class");
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("md:w-[32rem]"));
  assert.ok(cls.includes("max-w-full"));
  assert.ok(!/\sw-\[32rem\](\s|$)/.test(` ${cls} `));
});

test("button-like fixed child in column parent is forced to fill", () => {
  const html = `
    <div data-key="parent" class="flex flex-col gap-4">
      <button data-key="cta" data-w-intent="fixed" data-w-rem="22rem" class="btn self-center w-[22rem]">Book</button>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClassByKey(out.html, "cta");
  assert.ok(cls.includes("self-stretch"));
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-full"));
  assert.ok(!cls.includes("self-center"));
  assert.ok(!/\sw-\[22rem\](\s|$)/.test(` ${cls} `));
});

test("thumbs1 regression: CTA width matching parent becomes w-full self-stretch", () => {
  const html = fs.readFileSync(thumbsFixturePath, "utf8");
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClassByKey(out.html, "frame:thumbs1#1/instance:button#1");
  assert.ok(cls.includes("self-stretch"), "cta should stretch in fill column");
  assert.ok(cls.includes("w-full"), "cta should be full width");
  assert.ok(cls.includes("max-w-full"), "cta should stay responsive");
  assert.ok(!cls.includes("self-center"), "self-center should be removed");
  assert.ok(!/\sw-\[33\.5rem\](\s|$)/.test(` ${cls} `), "fixed width should be removed");
});

test("narrow CTA in column keeps intentional max-w", () => {
  const html = `
    <div data-key="parent" data-w-intent="fill" data-w-rem="33.5rem" class="flex flex-col">
      <button data-key="cta-narrow" data-w-intent="fixed" data-w-rem="20rem" class="btn self-center w-[20rem]">Book</button>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClassByKey(out.html, "cta-narrow");
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("self-stretch"));
  assert.ok(cls.includes("max-w-[20rem]"), "intentional narrow max-w should be preserved");
  assert.ok(!/\sw-\[20rem\](\s|$)/.test(` ${cls} `), "fixed width token should be removed");
});

test("fixed width under canonical ancestor container remains fluid", () => {
  const html = `
    <section>
      <div class="w-full max-w-[80rem] mx-auto">
        <div data-key="root" data-w-intent="fixed" data-w-rem="80rem" class="flex w-[80rem] gap-4">Content</div>
      </div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClassByKey(out.html, "root");
  assert.ok(cls.includes("w-full"), "root should be fluid under canonical ancestor");
  assert.ok(!/\sw-\[80rem\](\s|$)/.test(` ${cls} `), "fixed width should not be reintroduced");
});
