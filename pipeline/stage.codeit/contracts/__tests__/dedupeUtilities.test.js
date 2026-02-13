const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/classes/dedupeUtilities");

const getTokens = (html, key) => {
  const regex = new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i");
  const match = String(html || "").match(regex);
  if (!match) return [];
  return match[1].split(/\s+/g).filter(Boolean);
};

test("removes duplicate tokens while preserving order", () => {
  const html = `
    <div data-key="node" class="px-4 text-sm px-4 font-medium text-sm">
      Content
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const tokens = getTokens(out.html, "node");
  assert.deepEqual(tokens, ["px-4", "text-sm", "font-medium"]);
});
