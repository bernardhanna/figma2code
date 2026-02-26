const test = require("node:test");
const assert = require("node:assert/strict");
const { apply } = require("../layout/width/pruneRedundantFlexSizing");

test("prunes base grow/basis and md:flex-1 when md ratio sizing is explicit", () => {
  const html = `
  <div data-key="frame:text#1" class="flex flex-col grow basis-0 min-w-0 self-start md:flex-1 md:basis-2/3 md:max-w-[66.6667%] md:grow-0"></div>
  `;
  const out = apply({ html });
  assert.match(out.html, /md:basis-2\/3/);
  assert.match(out.html, /md:max-w-\[66\.6667%\]/);
  assert.match(out.html, /md:grow-0/);
  assert.doesNotMatch(out.html, /(^|\s)grow(\s|$)/);
  assert.doesNotMatch(out.html, /\bbasis-0\b/);
  assert.doesNotMatch(out.html, /\bmd:flex-1\b/);
});

test("keeps flex sizing when md ratio sizing is absent", () => {
  const html = `<div class="flex grow basis-0 md:flex-1"></div>`;
  const out = apply({ html });
  assert.equal(out.html.includes("grow"), true);
  assert.equal(out.html.includes("basis-0"), true);
  assert.equal(out.html.includes("md:flex-1"), true);
});
