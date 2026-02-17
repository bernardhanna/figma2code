const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { apply } = require("../layout/width/dedupeFillColumnWidths");

const getClassByKey = (html, key) => {
  const match = String(html || "").match(new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i"));
  return match ? match[1] : "";
};

const fixturePath = path.resolve(
  process.cwd(),
  "pipeline/stage.codeit/contracts/__tests__/fixtures/dedupeFillColumnWidths.fixture.html"
);

test("removes duplicate max-w down fill-column subtree", () => {
  const html = `
    <section>
      <div data-key="col" data-w-intent="fill" class="flex flex-col w-full max-w-[33.5rem] grow basis-0 min-w-0">
        <div data-key="wrap" class="w-full max-w-[33.5rem]">
          <h2 data-key="heading" class="w-full max-w-[33.5rem]">Title</h2>
          <p data-key="copy" class="w-full max-w-[33.5rem]">Body</p>
        </div>
      </div>
    </section>
  `;
  const out = apply({ html });
  const wrapCls = getClassByKey(out.html, "wrap");
  const h2Cls = getClassByKey(out.html, "heading");
  const pCls = getClassByKey(out.html, "copy");
  const rootCls = getClassByKey(out.html, "col");
  assert.ok(rootCls.includes("max-w-[33.5rem]"), "root constraint stays");
  assert.ok(!wrapCls.includes("max-w-[33.5rem]"), "matching descendant max-w removed");
  assert.ok(!h2Cls.includes("max-w-[33.5rem]"), "duplicate removed on heading");
  assert.ok(!pCls.includes("max-w-[33.5rem]"), "duplicate removed on paragraph");
});

test("keeps intentionally narrower descendant max-w", () => {
  const html = `
    <section>
      <div data-key="col" data-w-intent="fill" class="flex flex-col w-full max-w-[40rem] grow basis-0 min-w-0">
        <div data-key="wrap" class="w-full max-w-[40rem]">
          <div data-key="narrow" class="max-w-[20rem]">Narrow</div>
        </div>
      </div>
    </section>
  `;
  const out = apply({ html });
  const narrowCls = getClassByKey(out.html, "narrow");
  assert.ok(narrowCls.includes("max-w-[20rem]"), "narrow child max-w should remain");
});

test("does not dedupe when fill column root has no width constraint", () => {
  const html = `
    <section>
      <div data-key="col" data-w-intent="fill" class="flex flex-col grow basis-0 min-w-0">
        <div data-key="wrap" class="max-w-[33.5rem]">
          <h2 data-key="heading" class="max-w-[33.5rem]">Title</h2>
        </div>
      </div>
    </section>
  `;
  const out = apply({ html });
  const wrapCls = getClassByKey(out.html, "wrap");
  const headingCls = getClassByKey(out.html, "heading");
  assert.ok(wrapCls.includes("max-w-[33.5rem]"));
  assert.ok(headingCls.includes("max-w-[33.5rem]"));
});

test("fixture: max-w-[33.5rem] appears at most once per constrained column subtree", () => {
  const html = fs.readFileSync(fixturePath, "utf8");
  const out = apply({ html });
  const subtreeMatch = out.html.match(
    /<div[^>]*data-key="col-root"[\s\S]*?<\/div>\s*<\/section>/i
  );
  assert.ok(subtreeMatch, "constrained column subtree should exist");
  const subtree = subtreeMatch[0];
  const count = (subtree.match(/max-w-\[33\.5rem\]/g) || []).length;
  assert.ok(count <= 1, `expected at most one max-w-[33.5rem], got ${count}`);
});
