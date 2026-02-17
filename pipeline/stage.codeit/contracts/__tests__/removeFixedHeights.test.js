const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/height/removeFixedHeights");

const getTokens = (html, key) => {
  const regex = new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
};

const getFirstTagTokens = (html, tag) => {
  const regex = new RegExp(`<${tag}[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
};

test("removes fixed height from wrapper", () => {
  const html = `
    <div data-key="wrap" class="w-full h-[2.5rem] min-h-[1.5rem]">
      <span>Text</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "wrap");
  assert.ok(!tokens.includes("h-[2.5rem]"));
  assert.ok(!tokens.includes("min-h-[1.5rem]"));
});

test("keeps fixed height on image", () => {
  const html = `<img data-key="img" class="h-[3rem] w-full" />`;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getFirstTagTokens(out.html, "img");
  assert.ok(tokens.includes("h-[3rem]"));
});

test("keeps fixed height on media wrapper", () => {
  const html = `
    <div data-key="media" class="h-[4rem] w-full">
      <img src="/x.png" />
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "media");
  assert.ok(tokens.includes("h-[4rem]"));
});

test("removes base fixed heights but keeps md+ height constraints", () => {
  const html = `
    <div data-key="wrap" class="h-[6rem] min-h-[4rem] md:h-[12rem] lg:min-h-[10rem] w-full">
      <span>Text</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "wrap");
  assert.ok(!tokens.includes("h-[6rem]"));
  assert.ok(!tokens.includes("min-h-[4rem]"));
  assert.ok(tokens.includes("md:h-[12rem]"));
  assert.ok(tokens.includes("lg:min-h-[10rem]"));
});
