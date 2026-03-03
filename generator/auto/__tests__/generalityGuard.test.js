import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

test("auto passes avoid hardcoded slug/node-id targeting", () => {
  const autoDir = path.resolve(process.cwd(), "generator/auto");
  const files = walk(autoDir).filter((p) => !p.includes(`${path.sep}__tests__${path.sep}`));
  const rules = [
    { re: /\b\d{3,}:\d{3,}\b/g, reason: "hardcoded figma node id" },
    { re: /\b(hero(?:test)?\d+|counter\d+|events_1|copy2)\b/gi, reason: "hardcoded fixture slug/name" },
  ];

  const hits = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const { re, reason } of rules) {
      const m = src.match(re);
      if (m && m.length) hits.push(`${reason}: ${m[0]} in ${path.relative(process.cwd(), file)}`);
    }
  }

  assert.equal(hits.length, 0, hits.join("\n"));
});
