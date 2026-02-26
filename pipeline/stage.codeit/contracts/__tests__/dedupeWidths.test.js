const test = require("node:test");
const assert = require("node:assert/strict");

const { apply, proposePatchOps } = require("../layout/width/dedupeWidths");

const getTokens = (html, key) => {
  const regex = new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
};

test("removes redundant nested width when parent controls width", () => {
  const html = `
    <div data-key="parent" class="w-[20rem]">
      <div data-key="child" class="w-[20rem] max-w-full">Content</div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "child");
  assert.ok(!tokens.includes("w-[20rem]"));
  assert.ok(tokens.includes("max-w-full"));
});

test("proposePatchOps removes conflicting width tokens within same scope", () => {
  const ops = proposePatchOps({
    tokens: ["w-full", "w-[108rem]", "max-w-full", "max-w-[80rem]", "md:w-full", "md:w-1/2"],
    isWrapper: true,
  });
  assert.ok(ops);
  assert.ok(Array.isArray(ops.classRemove));
  assert.ok(ops.classRemove.includes("w-full"));
  assert.ok(ops.classRemove.includes("max-w-full"));
  assert.ok(ops.classRemove.includes("md:w-full"));
  assert.ok(!ops.classRemove.includes("w-[108rem]"));
  assert.ok(!ops.classRemove.includes("max-w-[80rem]"));
  assert.ok(!ops.classRemove.includes("md:w-1/2"));
});

test("proposePatchOps keeps w-full when wrapper also has matching max-w", () => {
  const ops = proposePatchOps({
    tokens: ["w-full", "w-[80rem]", "max-w-[80rem]", "mx-auto"],
    isWrapper: true,
  });
  assert.ok(ops);
  assert.ok(ops.classRemove.includes("w-[80rem]"));
  assert.ok(!ops.classRemove.includes("w-full"));
});

test("apply canonicalizes node with w-[X] + max-w-[X] to fluid container width", () => {
  const html = `
    <section class="w-full max-w-[80rem] mx-auto">
      <div data-key="root" class="w-[80rem] max-w-[80rem] px-4">Hello</div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "root");
  assert.ok(tokens.includes("w-full"));
  assert.ok(tokens.includes("max-w-[80rem]"));
  assert.ok(!tokens.includes("w-[80rem]"));
});

test("apply removes redundant descendant max-w under canonical ancestor container", () => {
  const html = `
    <section class="w-full max-w-[33.5rem] mx-auto">
      <h2 data-key="heading" class="w-full max-w-[33.5rem] text-xl">Title</h2>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "heading");
  assert.ok(tokens.includes("w-full"));
  assert.ok(!tokens.includes("max-w-[33.5rem]"));
});

test("apply prefers width token matching data-w-rem when widths conflict", () => {
  const html = `
    <section class="w-full">
      <div data-key="frame" data-w-rem="68rem" class="w-[68rem] w-[80rem] max-w-full">Content</div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "frame");
  assert.ok(tokens.includes("w-[68rem]"));
  assert.ok(!tokens.includes("w-[80rem]"));
});

test("apply replaces single mismatched width token using data-w-rem intent", () => {
  const html = `
    <section class="w-full">
      <div data-key="frame" data-w-rem="68rem" class="w-[80rem] max-w-full">Content</div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "frame");
  assert.ok(tokens.includes("w-[68rem]"));
  assert.ok(!tokens.includes("w-[80rem]"));
});

test("media-like wrapper keeps fluid width when conflicting fixed width is removed", () => {
  const html = `
    <section class="w-full">
      <div data-key="card" class="max-w-full w-[16.375rem] relative">
        <div class="absolute inset-0 bg-cover" style="background-image:url('/x.jpg')"></div>
        <img src="/x.jpg" alt="" />
      </div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "card");
  assert.ok(tokens.includes("max-w-full"));
  assert.ok(tokens.includes("w-full"));
  assert.ok(!tokens.includes("w-[16.375rem]"));
});
