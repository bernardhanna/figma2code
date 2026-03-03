const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

test("contracts avoid slug/id hardcoding patterns", () => {
  const contractsDir = path.resolve(__dirname, "..");
  const files = walkFiles(contractsDir).filter((p) => !p.includes(`${path.sep}__tests__${path.sep}`));
  const badHits = [];

  // Guard against brittle one-off fixes that lock on specific Figma IDs/slugs.
  const rules = [
    { re: /\b\d{3,}:\d{3,}\b/g, reason: "hardcoded figma node id" },
    { re: /\b(hero(?:test)?\d+|counter\d+|copy2|events_1)\b/gi, reason: "hardcoded fixture slug/name" },
  ];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const { re, reason } of rules) {
      const matches = text.match(re);
      if (matches && matches.length) {
        badHits.push({ file, reason, sample: matches[0] });
      }
    }
  }

  assert.equal(
    badHits.length,
    0,
    badHits
      .map((h) => `${h.reason}: ${h.sample} in ${path.relative(process.cwd(), h.file)}`)
      .join("\n")
  );
});
