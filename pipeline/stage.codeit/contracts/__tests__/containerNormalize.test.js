const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/section/containerNormalize");

const hasStructure = (html, outer, inner) => {
  const re = new RegExp(
    `<${outer}[^>]*>[^<]*<${inner}[^>]*class="[^"]*w-full[^"]*max-w`,
    "i"
  );
  return re.test(html);
};

test("wrapper div -> section becomes section -> container div", () => {
  const html = `
    <div class="w-full max-w-7xl">
      <section>
        <h2>Title</h2>
        <p>Content</p>
      </section>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(
    hasStructure(out.html, "section", "div"),
    "section is outer, div with w-full max-w is inner"
  );
  assert.ok(out.html.includes("max-w-7xl"), "container keeps source max-w class");
  assert.ok(out.html.includes("mx-auto"), "mx-auto on container");
  assert.ok(out.html.includes("<h2>Title</h2>"), "content preserved");
  assert.equal(out.stats.normalized, 1);
});

test("section styling (padding/bg) preserved on section after swap", () => {
  const html = `
    <div class="w-full max-w-6xl py-12 bg-gray-100">
      <section class="main">
        <p>Content</p>
      </section>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("<section"), "section is outer");
  assert.ok(
    out.html.includes("py-12") || out.html.includes("bg-gray-100"),
    "section-level classes from div preserved on section"
  );
  assert.ok(out.html.includes("w-full max-w-6xl mx-auto"), "container inner keeps wrapper max-w");
  assert.equal(out.stats.normalized, 1);
});

test("div container wrapping single section becomes section wrapping div container", () => {
  const html = `
    <div class="w-full max-w-5xl mx-auto">
      <section><p>Only child</p></section>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(hasStructure(out.html, "section", "div"));
  assert.equal(out.stats.normalized, 1);
});

test("section > container div > section becomes section > container div", () => {
  const html = `
    <section class="relative overflow-hidden">
      <div class="w-full max-w-6xl mx-auto">
        <section class="flex flex-col gap-6 px-8" data-key="root">
          <h2>Title</h2>
        </section>
      </div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("<section class=\"relative overflow-hidden\">"));
  assert.ok(out.html.includes("w-full max-w-6xl mx-auto"));
  assert.ok(out.html.includes("flex flex-col gap-6 px-8"), "inner section classes moved to container");
  assert.ok(!out.html.includes("<section class=\"flex flex-col"), "inner section removed");
  assert.ok(out.html.includes("data-key=\"root\""), "data attributes preserved on container");
  assert.equal(out.stats.normalized, 1);
});

test("skip when outer div has multiple children", () => {
  const html = `
    <div class="w-full max-w-5xl">
      <section><p>A</p></section>
      <section><p>B</p></section>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.normalized, 0);
});

test("idempotent: running twice yields no further diffs", () => {
  const html = `
    <div class="w-full max-w-7xl">
      <section><span>X</span></section>
    </div>
  `;
  const first = apply({ html, artifact: {}, options: {} });
  const second = apply({ html: first.html, artifact: {}, options: {} });
  assert.equal(second.stats.normalized, 0, "second run does nothing");
  assert.equal(first.html, second.html, "output stable");
});
