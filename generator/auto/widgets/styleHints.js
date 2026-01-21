// generator/auto/widgets/styleHints.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = { loaded: false, hints: null };

function isTextTemplate(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".php" || ext === ".html" || ext === ".htm" || ext === ".txt";
}

function scanFileForTokens(file, tokens, found) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return;
    const content = fs.readFileSync(file, "utf8");
    for (const t of tokens) {
      if (content.includes(t)) found.add(t);
    }
  } catch {
    // ignore
  }
}

function walkDir(dir, tokens, found) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkDir(full, tokens, found);
      continue;
    }
    if (!isTextTemplate(full)) continue;
    scanFileForTokens(full, tokens, found);
  }
}

export function loadStyleHints(opts = {}) {
  if (CACHE.loaded && CACHE.hints) return CACHE.hints;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = opts.repoRoot || path.resolve(__dirname, "..", "..", "..");
  const componentsDir = path.resolve(repoRoot, "components");

  const tokens = ["max-w-container", "w-container"];
  const found = new Set();

  if (fs.existsSync(componentsDir)) {
    walkDir(componentsDir, tokens, found);
  }

  const hints = {
    tokens: Array.from(found),
    containerClass: found.has("max-w-container")
      ? "max-w-container"
      : found.has("w-container")
        ? "w-container"
        : "",
  };

  CACHE.loaded = true;
  CACHE.hints = hints;
  return hints;
}
