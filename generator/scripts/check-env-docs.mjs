import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GENERATOR_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(GENERATOR_ROOT, "..");
const DOC_PATH = path.join(REPO_ROOT, "docs", "env-controls.md");

const SOURCE_DIRS = [
  path.join(GENERATOR_ROOT, "auto"),
  path.join(GENERATOR_ROOT, "server"),
  path.join(GENERATOR_ROOT, "templates"),
  path.join(GENERATOR_ROOT, "passes"),
  path.join(GENERATOR_ROOT, "contracts"),
  path.join(GENERATOR_ROOT, "export"),
  path.join(GENERATOR_ROOT, "config"),
];

const SOURCE_FILES = [path.join(GENERATOR_ROOT, "server.js")];

function collectJsFiles(startPath, out = []) {
  if (!fs.existsSync(startPath)) return out;
  const stat = fs.statSync(startPath);
  if (stat.isFile()) {
    if (startPath.endsWith(".js") || startPath.endsWith(".mjs")) out.push(startPath);
    return out;
  }
  const entries = fs.readdirSync(startPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const full = path.join(startPath, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && (full.endsWith(".js") || full.endsWith(".mjs"))) out.push(full);
  }
  return out;
}

function extractEnvFromSource(source) {
  const vars = new Set();
  const dotRe = /process\.env\.([A-Z0-9_]+)/g;
  const bracketRe = /process\.env\[(?:'|")([A-Z0-9_]+)(?:'|")\]/g;

  let m;
  while ((m = dotRe.exec(source))) vars.add(m[1]);
  while ((m = bracketRe.exec(source))) vars.add(m[1]);
  return vars;
}

function extractDocVars(docText) {
  const vars = new Set();
  const lines = String(docText || "").split(/\r?\n/);
  for (const line of lines) {
    // Expected table format: | `VAR_NAME` | default | purpose |
    const m = line.match(/^\|\s*`([A-Z0-9_]+)`\s*\|/);
    if (m?.[1]) vars.add(m[1]);
  }
  return vars;
}

function sorted(arr) {
  return [...arr].sort((a, b) => a.localeCompare(b));
}

function main() {
  if (!fs.existsSync(DOC_PATH)) {
    console.error(`Missing docs file: ${DOC_PATH}`);
    process.exit(2);
  }

  const sourceFiles = [
    ...SOURCE_DIRS.flatMap((dir) => collectJsFiles(dir)),
    ...SOURCE_FILES.filter((f) => fs.existsSync(f)),
  ];

  const usedVars = new Set();
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    const fileVars = extractEnvFromSource(source);
    for (const v of fileVars) usedVars.add(v);
  }

  const docVars = extractDocVars(fs.readFileSync(DOC_PATH, "utf8"));

  const missingInDocs = sorted([...usedVars].filter((v) => !docVars.has(v)));
  const staleInDocs = sorted([...docVars].filter((v) => !usedVars.has(v)));

  if (missingInDocs.length) {
    console.error("Env vars used in code but missing from docs/env-controls.md:");
    for (const v of missingInDocs) console.error(`  - ${v}`);
  }

  if (staleInDocs.length) {
    console.warn("Env vars documented but not currently used in scanned app code:");
    for (const v of staleInDocs) console.warn(`  - ${v}`);
  }

  if (missingInDocs.length) process.exit(1);
  console.log(`env-controls check passed (${usedVars.size} vars used, ${docVars.size} vars documented).`);
}

main();

