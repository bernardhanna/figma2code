const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/dedupeWidths");

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
