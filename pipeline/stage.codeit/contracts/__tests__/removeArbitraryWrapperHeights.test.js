const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/height/removeArbitraryWrapperHeights");

const getTokens = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) {
    const alt = new RegExp(`class="([^"]*)"[^>]*data-key="${dataKey}"`, "i");
    const m2 = String(html || "").match(alt);
    return m2 ? m2[1].split(/\s+/g).filter(Boolean) : [];
  }
  return match[1].split(/\s+/g).filter(Boolean);
};

const hasToken = (tokens, token) => tokens.includes(token);

test("column wrapper with overflow-hidden w-[33.5rem] h-[38.831875rem] -> remove height", () => {
  const html = `
    <div data-key="col" class="flex flex-col overflow-hidden w-[33.5rem] max-w-full h-[38.831875rem]">
      <span>Content</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "col");
  assert.ok(!hasToken(tokens, "h-[38.831875rem]"), "arbitrary height removed");
  assert.ok(hasToken(tokens, "h-auto"), "h-auto added");
  assert.ok(hasToken(tokens, "overflow-hidden"));
  assert.equal(out.stats.removed, 1);
});

test("image wrapper overflow-hidden h-[23.769375rem] with child img.object-cover -> keep wrapper height", () => {
  const html = `
    <div data-key="image" class="overflow-hidden h-[23.769375rem] w-full">
      <img src="/x.jpg" alt="" class="h-[23.769375rem] w-full object-cover" />
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "image");
  assert.ok(hasToken(tokens, "h-[23.769375rem]"), "wrapper height kept (media framing)");
  assert.equal(out.stats.removed, 0);
});

test("decorative bar h-[0.3125rem] -> keep", () => {
  const html = `
    <div data-key="bar" class="w-full h-[0.3125rem] bg-orange-500"></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "bar");
  assert.ok(hasToken(tokens, "h-[0.3125rem]"));
  assert.equal(out.stats.removed, 0);
});

test("wrapper with min-h-screen keeps height", () => {
  const html = `<div data-key="hero" class="min-h-screen w-full h-[40rem]">Hero</div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "hero");
  assert.ok(hasToken(tokens, "min-h-screen"));
  assert.ok(hasToken(tokens, "h-[40rem]"));
  assert.equal(out.stats.removed, 0);
});
