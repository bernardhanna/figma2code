// generator/server/learnedRulesStore.js

import fs from "node:fs";
import { RULES_PATH } from "./runtimePaths.js";

export function readRules() {
  try {
    if (!fs.existsSync(RULES_PATH)) return [];
    const json = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
    return Array.isArray(json?.rules) ? json.rules : [];
  } catch (e) {
    console.warn("[learn] failed to read rules.json:", String(e?.message || e));
    return [];
  }
}

// Find first matching classReplace rule given a list of class tokens
export function findClassReplaceRule(rules, classTokens) {
  if (!Array.isArray(rules) || !rules.length) return null;
  const tokenSet = new Set(classTokens);

  const sorted = rules.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  for (const r of sorted) {
    const from = String(r?.when?.class || "").trim();
    const to = String(r?.then?.replace || "").trim();
    if (!from || !to) continue;
    if (tokenSet.has(from)) return { from, to, confidence: r.confidence || 0 };
  }
  return null;
}
