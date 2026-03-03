const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/height/stripWrapperFixedHeightsStrict");

const getTokens = (html, dataKey) => {
  const str = String(html || "");
  let m = str.match(new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i"));
  if (!m) m = str.match(new RegExp(`class="([^"]*)"[^>]*data-key="${dataKey}"`, "i"));
  if (!m) return [];
  return m[1].split(/\s+/g).filter(Boolean);
};

const hasToken = (tokens, token) => tokens.includes(token);

test("column wrapper with text+button+image descendant => height removed", () => {
  const html = `
    <div data-key="col" class="flex flex-col h-[40rem] w-full">
      <p>Text</p>
      <button type="button">Action</button>
      <img src="/x.jpg" alt="" class="w-full" />
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "col");
  assert.ok(!hasToken(tokens, "h-[40rem]"));
  assert.ok(hasToken(tokens, "h-auto"));
  assert.ok(out.stats.stripped >= 1);
});

test("wrapper where first child is img with object-cover => wrapper height kept", () => {
  const html = `
    <div data-key="media" class="overflow-hidden h-[23rem] w-full rounded">
      <img src="/hero.jpg" alt="" class="w-full h-full object-cover" />
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "media");
  assert.ok(hasToken(tokens, "h-[23rem]"), "true media wrapper height kept");
  assert.equal(out.stats.stripped, 0);
});

test("decorative bar height kept", () => {
  const html = `
    <div data-key="bar" class="w-full h-[0.3125rem] bg-orange-500"></div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "bar");
  assert.ok(hasToken(tokens, "h-[0.3125rem]"));
  assert.equal(out.stats.stripped, 0);
});

test("wrapper with overflow-hidden but first child not img/video => height stripped", () => {
  const html = `<div data-key="wrap" class="overflow-hidden h-[30rem]"><span>Content</span></div>`;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "wrap");
  assert.ok(!hasToken(tokens, "h-[30rem]"));
  assert.ok(hasToken(tokens, "h-auto"));
});

test("wrapper with absolute background fill child keeps fixed height", () => {
  const html = `
    <div data-key="card" class="relative overflow-hidden h-[20rem] rounded">
      <div class="absolute inset-0 bg-cover bg-no-repeat bg-center" style="background-image: url('/x.jpg')"></div>
      <img src="/x.jpg" alt="" class="w-full h-full object-cover" />
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "card");
  assert.ok(hasToken(tokens, "h-[20rem]"));
  assert.ok(!hasToken(tokens, "h-auto"));
});

test("wrapper keeps fixed height when absolute bg layer is hinted by data-key", () => {
  const html = `
    <div data-key="card2" class="relative overflow-hidden h-[20rem] rounded">
      <div data-key="frame:item#2/frame:image#1/rectangle:image-11#1" class="absolute inset-0 bg-cover bg-no-repeat bg-center"></div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "card2");
  assert.ok(hasToken(tokens, "h-[20rem]"));
  assert.ok(!hasToken(tokens, "h-auto"));
});
