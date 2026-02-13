const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../semantics/interactive/cardToLinkOrButton");

const getClass = (html, dataKey) => {
  const regex = new RegExp(`data-key="${dataKey}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1].trim() : "";
};

const hasTag = (html, tag, dataKey) => {
  const regex = new RegExp(
    `<${tag}[^>]*data-key="${dataKey}"`,
    "i"
  );
  return regex.test(html);
};

test("div card with hover/focus but no href preserves state styles", () => {
  const html = `
    <div data-key="card" class="rounded-lg shadow hover:shadow-lg focus-visible:ring-2 btn cursor-pointer p-4">
      <h3>Title</h3>
      <p>Content</p>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClass(out.html, "card");
  assert.ok(cls.includes("hover:"), "hover retained");
  assert.ok(cls.includes("focus-visible:"), "focus-visible retained");
  assert.ok(cls.includes("btn"), "btn retained");
  assert.ok(/ring-2|ring\b/.test(cls), "ring utilities retained");
  assert.ok(out.html.includes("<div "), "still a div");
  assert.ok(out.stats.updated >= 1);
});

test("card that wraps single <a href> is upgraded to outer link", () => {
  const html = `
    <div data-key="card" class="block rounded hover:bg-gray-100 focus-visible:ring-2 p-4">
      <a href="/page">Card title and content</a>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(hasTag(out.html, "a", "card"), "outer element is now <a>");
  assert.ok(out.html.includes('href="/page"'), "href hoisted");
  assert.ok(!out.html.includes("<a href=\"/page\">Card title"), "inner <a> removed (no duplicate)");
  assert.ok(out.html.includes("Card title and content"), "content preserved");
  assert.ok(out.stats.updated >= 1);
});

test("div with affordances and multiple children preserves state styles", () => {
  const html = `
    <div data-key="card" class="hover:shadow btn p-4">
      <h3>Title</h3>
      <a href="/x">Link</a>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("<div "), "still a div (not single link child)");
  const cls = getClass(out.html, "card");
  assert.ok(cls.includes("hover:shadow"), "hover retained");
  assert.ok(cls.includes("btn"), "btn retained");
});
