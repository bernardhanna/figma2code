const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { apply } = require("../layout/section/containerRootOnly");

const fixturePath = path.resolve(
  process.cwd(),
  "pipeline/stage.codeit/contracts/__tests__/fixtures/containerRootOnly.fixture.html"
);

const getClassByKey = (html, key) => {
  const m = String(html || "").match(new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i"));
  return m ? m[1] : "";
};

const countContainerSignaturesInSection = (html) => {
  const sectionMatch = String(html || "").match(/<section[\s\S]*<\/section>/i);
  if (!sectionMatch) return 0;
  const sectionHtml = sectionMatch[0];
  const tags = sectionHtml.match(/<[^>]+class="[^"]*"[^>]*>/g) || [];
  let count = 0;
  tags.forEach((tag) => {
    const clsMatch = tag.match(/class="([^"]*)"/i);
    if (!clsMatch) return;
    const tokens = clsMatch[1].split(/\s+/g).filter(Boolean);
    const cores = tokens.map((t) => String(t).split(":").pop());
    const hasMxAuto = cores.includes("mx-auto");
    const hasMaxW = cores.some((c) => c === "max-w-container" || /^max-w-/.test(c));
    if (hasMxAuto && hasMaxW) count += 1;
  });
  return count;
};

test("removes repeated nested container signatures under one section", () => {
  const html = fs.readFileSync(fixturePath, "utf8");
  const out = apply({ html });

  const top = getClassByKey(out.html, "container:top");
  assert.ok(top.includes("mx-auto"), "top-level container remains");
  assert.ok(top.includes("max-w-[80rem]"), "top-level max width remains");

  const nestedBad = getClassByKey(out.html, "nested:container:bad");
  assert.ok(!nestedBad.includes("mx-auto"), "nested mx-auto removed");
  assert.ok(!nestedBad.includes("max-w-[80rem]"), "nested max-w removed");

});

test("regression fixture: at most one container signature per section subtree", () => {
  const html = fs.readFileSync(fixturePath, "utf8");
  const out = apply({ html });
  const count = countContainerSignaturesInSection(out.html);
  assert.equal(count, 1, "only top-level container signature should remain");
});

test("explicit keep marker preserves nested container signature", () => {
  const html = `<section><div class="w-full max-w-[80rem] mx-auto"><div data-key="keep" data-keep-container="1" class="w-full max-w-container mx-auto">X</div></div></section>`;
  const out = apply({ html });
  const keepCls = getClassByKey(out.html, "keep");
  assert.ok(keepCls.includes("mx-auto"));
  assert.ok(keepCls.includes("max-w-container"));
});
