// generator/server/stageStore.js

import fs from "node:fs";
import path from "node:path";
import { STAGING_DIR } from "./runtimePaths.js";

export function writeStage(slug, ast, fragment, extra = {}) {
  const payload = { slug, when: Date.now(), ast, fragment, ...extra };
  const out = path.join(STAGING_DIR, `${slug}.json`);
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  return out;
}

export function readStage(slug) {
  const file = path.join(STAGING_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writePhase2Normalized(slug, astNormalized) {
  const dir = path.join(STAGING_DIR, "phase2", slug);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "phase2.normalized.json");
  fs.writeFileSync(out, JSON.stringify(astNormalized, null, 2), "utf8");
  return out;
}

export function writePhase3Intent(slug, intentGraph) {
  const dir = path.join(STAGING_DIR, "phase3", slug);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "phase3.intent.json");
  fs.writeFileSync(out, JSON.stringify(intentGraph, null, 2), "utf8");
  return out;
}

export function listStages() {
  if (!fs.existsSync(STAGING_DIR)) return [];
  return fs
    .readdirSync(STAGING_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(STAGING_DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function deleteStage(slug) {
  const file = path.join(STAGING_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
