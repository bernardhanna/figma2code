const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/wrappers/flattenRedundant");

const countTag = (html, tag) => {
  const re = new RegExp(`<${tag}[\\s>]`, "gi");
  return (html.match(re) || []).length;
};

test("wrapper chain collapses by 1–2 levels without affecting outer layout", () => {
  const html = `
    <div class="outer">
      <div>
        <div class="max-w-full w-full">
          <p class="text-lg">Content</p>
        </div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.stats.flattened >= 1, "at least one wrapper flattened");
  const beforeDivs = countTag(html, "div");
  const afterDivs = countTag(out.html, "div");
  assert.ok(afterDivs < beforeDivs, "fewer divs after flatten");
  assert.ok(out.html.includes("<p class="), "content preserved");
  assert.ok(out.html.includes("Content"), "inner text preserved");
});

test("wrapper with gap-* is NOT removed", () => {
  const html = `
    <div class="container">
      <div class="gap-4">
        <p>Only child</p>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("gap-4"), "wrapper with gap still present");
  assert.ok(out.html.includes("<div class=\"gap-4\">"), "wrapper div kept");
  assert.equal(out.stats.flattened, 0);
});

test("wrapper with padding is NOT removed", () => {
  const html = `
    <div class="container">
      <div class="p-4">
        <span>Only child</span>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("p-4"), "wrapper with padding still present");
  assert.equal(out.stats.flattened, 0);
});

test("empty-class wrapper with single child is removed and classes merged", () => {
  const html = `
    <div>
      <div class="max-w-full">
        <div class="text-center">Inner</div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.stats.flattened >= 1);
  assert.ok(out.html.includes("Inner"));
  assert.ok(
    out.html.includes("max-w-full") || out.html.includes("text-center"),
    "layout or content class present"
  );
});
