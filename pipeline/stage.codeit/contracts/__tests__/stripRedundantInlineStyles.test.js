const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../style/inline/stripRedundantInlineStyles");

const getAttr = (html, attr) => {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1] : null;
};

test("replaces width:100% with w-full", () => {
  const html = `<h3 style="width: 100%;"></h3>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class") || "";
  const style = getAttr(out.html, "style");
  assert.ok(cls.includes("w-full"));
  assert.equal(style, null);
  assert.equal(out.stats.stripped, 1);
});

test("preserves other inline styles while stripping width", () => {
  const html = `<h3 style="width:100%; color: red;"></h3>`;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getAttr(out.html, "class") || "";
  const style = getAttr(out.html, "style") || "";
  assert.ok(cls.includes("w-full"));
  assert.ok(style.includes("color: red"));
  assert.ok(!style.includes("width"));
});
