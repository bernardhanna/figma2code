// compile-rules.mjs
// Compile learned patch ops (dataset jsonl) into deterministic rules.json
//
// Input:  generator/learn/patch-dataset.jsonl   (JSONL, one record per line)
// Output: generator/learn/rules.json            ({ rules: [...] })
//
// Rule shape:
// {
//   when: { class: "gap-6" },
//   then: { replace: "gap-5" },
//   confidence: 0.8,
//   stats: { count: 12 }
// }

import fs from "node:fs";
import path from "node:path";

const DATASET = path.resolve("generator/learn/patch-dataset.jsonl");
const OUT = path.resolve("generator/learn/rules.json");

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Aggregate classReplace ops into frequency counts so we can:
 * - dedupe
 * - raise confidence when repeated
 */
function compileRules(rows) {
  const counts = new Map(); // key: `${from}=>${to}`

  for (const r of rows) {
    const ops = Array.isArray(r?.ops) ? r.ops : [];
    for (const op of ops) {
      if (!op || op.type !== "classReplace") continue;
      const from = String(op.from || "").trim();
      const to = String(op.to || "").trim();
      if (!from || !to || from === to) continue;

      const key = `${from}=>${to}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  // Turn counts into rules with confidence scaling
  const rules = [];
  for (const [key, count] of counts.entries()) {
    const [from, to] = key.split("=>");

    // Confidence heuristic:
    // - starts at 0.70
    // - grows with repetitions
    // - caps at 0.95
    const confidence = Math.min(0.95, 0.7 + Math.log10(1 + count) * 0.15);

    rules.push({
      when: { class: from },
      then: { replace: to },
      confidence: Number(confidence.toFixed(3)),
      stats: { count },
    });
  }

  // Highest confidence first (and stable tie-break)
  rules.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.stats.count !== a.stats.count) return b.stats.count - a.stats.count;
    return String(a.when.class).localeCompare(String(b.when.class));
  });

  return rules;
}

function main() {
  const raw = safeRead(DATASET);
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);

  const rows = [];
  let bad = 0;

  for (const line of lines) {
    const obj = safeJsonParse(line);
    if (!obj) {
      bad++;
      continue;
    }
    rows.push(obj);
  }

  const rules = compileRules(rows);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ rules }, null, 2), "utf8");

  console.log(
    `[compile-rules] wrote ${rules.length} rules to ${OUT}` +
    (bad ? ` (skipped ${bad} invalid lines)` : "")
  );
}

main();
