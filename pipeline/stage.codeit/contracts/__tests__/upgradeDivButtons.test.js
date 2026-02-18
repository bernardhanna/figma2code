const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../semantics/interactive/upgradeDivButtons");

const hasTag = (html, tag, dataKey) => {
  const regex = new RegExp(`<${tag}[^>]*data-key="${dataKey}"`, "i");
  return regex.test(html);
};

test("wrapper already <button> or <a> is no-op", () => {
  const buttonHtml = `<button type="button" data-key="b" class="btn p-4">Click</button>`;
  const outButton = apply({ html: buttonHtml, artifact: {}, options: {} });
  assert.equal(outButton.stats.upgraded, 0, "button unchanged");
  assert.ok(outButton.html.includes("<button "), "still button");

  const anchorHtml = `<a href="/x" data-key="link" class="btn p-4">Link</a>`;
  const outAnchor = apply({ html: anchorHtml, artifact: {}, options: {} });
  assert.equal(outAnchor.stats.upgraded, 0, "anchor unchanged");
  assert.ok(outAnchor.html.includes("<a "), "still anchor");
});

test("decorative node is no-op", () => {
  const html = `
    <div data-decorative="1" data-key="dec" class="btn p-4 rounded bg-gray-200">
      <span>Deco</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.upgraded, 0, "decorative div not upgraded");
  assert.ok(out.html.includes("<div "), "still div");
  assert.ok(out.html.includes('data-decorative="1"'), "decorative attr preserved");
});

test("wrapper contains inner <a> -> wrapper becomes <a>, inner becomes <span>", () => {
  const html = `
    <div data-key="cta" class="btn p-4 rounded hover:bg-gray-100">
      <a href="/page" class="text-blue-600">Go to page</a>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.stats.upgraded >= 1);
  assert.ok(hasTag(out.html, "a", "cta"), "outer element is <a>");
  assert.ok(out.html.includes('href="/page"'), "href on outer");
  assert.ok(out.html.includes("<span "), "inner is span");
  assert.ok(out.html.includes("text-blue-600"), "inner classes preserved");
  assert.ok(out.html.includes("Go to page"), "content preserved");
  const aCount = (out.html.match(/<a\s/g) || []).length;
  assert.equal(aCount, 1, "exactly one <a> (no nested anchor)");
});

test("button-like div with no link becomes <button type=\"button\">", () => {
  const html = `
    <div data-key="submit" class="btn p-4 rounded bg-blue-500 text-white">
      <span>Submit</span>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.stats.upgraded >= 1);
  assert.ok(out.html.includes("<button "), "wrapper is button");
  assert.ok(out.html.includes('type="button"'), "type=button");
  assert.ok(out.html.includes("btn p-4 rounded"), "classes preserved");
  assert.ok(out.html.includes("<span>Submit</span>"), "inner preserved");
});
