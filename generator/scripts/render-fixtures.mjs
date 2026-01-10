// generator/scripts/render-fixtures.mjs
// Renders fixtures by POSTing each fixture's ast.json to /api/preview-only
// Writes preview HTML to generator/fixtures.out/<slug>/preview.html

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd(); // generator/
const FIXTURES_DIR = path.join(ROOT, "fixtures");
const OUT_DIR = path.join(ROOT, "fixtures.out");

function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`Failed to read JSON: ${filePath}\n${String(e?.message || e)}`);
  }

  if (!raw || !raw.trim()) {
    throw new Error(`JSON file is empty (0 bytes or whitespace only): ${filePath}`);
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    const snippet = raw.slice(0, 400);
    throw new Error(
      `Invalid JSON in: ${filePath}\n` +
      `Parse error: ${String(e?.message || e)}\n` +
      `First 400 chars:\n${snippet}\n`
    );
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Non-JSON response from ${url} (status ${res.status}). First 400 chars:\n${text.slice(0, 400)}`
    );
  }

  if (!res.ok || !json?.ok) {
    throw new Error(
      `Request failed (${res.status}) POST ${url}\n` +
      `Response:\n${JSON.stringify(json, null, 2)}`
    );
  }

  return json;
}

function listFixtureSlugs() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    throw new Error(`Missing fixtures dir: ${FIXTURES_DIR}`);
  }

  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith("."))
    .sort();
}

async function runOne(serverUrl, slug) {
  const astPath = path.join(FIXTURES_DIR, slug, "ast.json");
  if (!fs.existsSync(astPath)) {
    throw new Error(`Missing ast.json for fixture "${slug}": ${astPath}`);
  }

  const ast = readJson(astPath);
  if (!ast?.slug) ast.slug = slug;

  const outDir = path.join(OUT_DIR, slug);
  ensureDir(outDir);

  const apiUrl = `${serverUrl.replace(/\/$/, "")}/api/preview-only`;
  const res = await postJson(apiUrl, ast);

  // The server writes the preview html file under ../.preview/<slug>.html
  // We fetch it and copy into fixtures.out for visual diff scripts.
  const previewUrl = `${serverUrl.replace(/\/$/, "")}${res.previewUrl}`;
  const htmlRes = await fetch(previewUrl);
  const html = await htmlRes.text();

  const outHtml = path.join(outDir, "preview.html");
  fs.writeFileSync(outHtml, html, "utf8");

  return { slug, outHtml, previewUrl };
}

async function main() {
  const manifestPath = path.join(FIXTURES_DIR, "index.json");
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};
  const serverUrl = manifest.serverUrl || "http://127.0.0.1:5173";

  const slugs = listFixtureSlugs();
  console.log(`Generator URL: ${serverUrl}`);
  console.log(`Fixtures: ${slugs.length}`);

  ensureDir(OUT_DIR);

  for (const slug of slugs) {
    console.log(`\n→ Rendering: ${slug}`);
    const r = await runOne(serverUrl, slug);
    console.log(`  ✓ wrote ${path.relative(ROOT, r.outHtml)}`);
  }

  console.log(`\nDone. Output: ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((e) => {
  console.error("\nFixtures render failed:\n" + String(e?.message || e));
  process.exit(1);
});
