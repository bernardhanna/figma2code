import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths relative to THIS FILE, not cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// generator/server → generator
export const ROOT = path.resolve(__dirname, "..");

// Preview / assets dirs
export const PREVIEW_DIR = path.join(ROOT, ".preview");
export const ASSETS_DIR = path.join(PREVIEW_DIR, "assets");
export const STAGING_DIR = path.join(PREVIEW_DIR, "staging");

// Visual diff output dir: generator/fixtures.out/<slug>/...
export const VDIFF_DIR = path.join(ROOT, "fixtures.out");

// Learned rules runtime dir
export const LEARN_DIR = path.join(ROOT, "learn");
export const RULES_PATH = path.join(LEARN_DIR, "rules.json");

export function ensureRuntimeDirs() {
  for (const d of [PREVIEW_DIR, ASSETS_DIR, STAGING_DIR, VDIFF_DIR, LEARN_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
