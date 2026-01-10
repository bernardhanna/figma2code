// generator/server/stageStore.js

import fs from "node:fs";
import path from "node:path";

import { STAGING_DIR } from "./runtimePaths.js";

const DIR = path.join(STAGING_DIR, "staging");

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function stagePath(slug) {
  return path.join(DIR, `${String(slug || "").trim()}.json`);
}

export function writeStage(slug, ast) {
  ensureDir();
  const s = String(slug || "").trim();
  if (!s) throw new Error("writeStage: missing slug");
  const file = stagePath(s);
  fs.writeFileSync(file, JSON.stringify({ slug: s, when: Date.now(), ast }, null, 2), "utf8");
  return file;
}

export function readStage(slug) {
  ensureDir();
  const file = stagePath(slug);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function listStages() {
  ensureDir();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
        return { slug: j.slug, when: j.when };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.when || 0) - (a.when || 0));
}

export function deleteStage(slug) {
  ensureDir();
  const file = stagePath(slug);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
