// generator/componentLibrary/index.js
//
// Scans /components/<type>/<id>/ and builds an index of canonical component examples.
// Loaded once at server startup and used as scaffolding for future PHP/ACF export matching.

import fs from "node:fs";
import path from "node:path";

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReadFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseAcfFieldKeysBestEffort(phpSource) {
  const src = String(phpSource || "");
  const keys = [];

  // Common builder style: ->addText('field_key'), ->addImage("field_key"), ->addRepeater('items'), etc
  {
    const re = /->\s*add(?:Field|Text|Textarea|Wysiwyg|Image|Gallery|File|Link|Url|Email|Number|Range|Select|Radio|TrueFalse|ButtonGroup|Checkbox|Group|Repeater|FlexibleContent|PostObject|Relationship|Taxonomy|User|DatePicker|DateTimePicker|TimePicker)\s*\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) keys.push(m[1]);
  }

  // ACF array style: 'name' => 'field_key'
  {
    const re = /['"]name['"]\s*=>\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) keys.push(m[1]);
  }

  // Some code uses 'field_name', 'foo'
  {
    const re = /['"]field_name['"]\s*,\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) keys.push(m[1]);
  }

  // Fallback: get_field('field_key') / the_field("field_key")
  {
    const re = /\b(?:get_field|the_field)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) keys.push(m[1]);
  }

  return uniq(keys);
}

function pickFirstExistingFile(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function pickPreviewImage(dir, type, id) {
  // Prefer explicit <type>_<id>.(jpg/png/webp), else any image in folder.
  const preferred = [
    `${type}_${id}.jpg`,
    `${type}_${id}.jpeg`,
    `${type}_${id}.png`,
    `${type}_${id}.webp`,
  ];
  const first = pickFirstExistingFile(dir, preferred);
  if (first) return first;

  try {
    const files = fs.readdirSync(dir);
    const imgs = files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
    if (!imgs.length) return null;
    imgs.sort((a, b) => a.localeCompare(b));
    return path.join(dir, imgs[0]);
  } catch {
    return null;
  }
}

function coerceVariantId(dirName) {
  const s = String(dirName || "").trim();
  if (!s) return "";
  // Keep 001-like ids as-is; accept numeric folder names too.
  const m = s.match(/^\d+$/);
  return m ? s.padStart(3, "0") : s;
}

export function buildComponentLibraryIndexSync({
  componentsDir,
  debug = false,
} = {}) {
  const root = String(componentsDir || "").trim();
  if (!root) throw new Error("buildComponentLibraryIndexSync: missing componentsDir");
  if (!isDir(root)) throw new Error(`buildComponentLibraryIndexSync: not a directory: ${root}`);

  const entries = [];
  const byType = {};

  const types = fs
    .readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .map((name) => ({ name, full: path.join(root, name) }))
    .filter((x) => isDir(x.full))
    .map((x) => x.name)
    .sort((a, b) => a.localeCompare(b));

  for (const type of types) {
    const typeDir = path.join(root, type);
    const variantDirs = fs
      .readdirSync(typeDir)
      .filter((name) => !name.startsWith("."))
      .map((name) => ({ name, full: path.join(typeDir, name) }))
      .filter((x) => isDir(x.full))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const v of variantDirs) {
      const id = coerceVariantId(v.name);
      if (!id) continue;

      const dir = v.full;
      const phpTemplatePath = pickFirstExistingFile(dir, [
        `${type}_${id}.php`,
        `${type}.php`,
        "index.php",
      ]);

      const acfPhpPath = pickFirstExistingFile(dir, [
        `acf_${type}_${id}.php`,
        `acf_${type}.php`,
      ]);

      const previewImagePath = pickPreviewImage(dir, type, id);

      const acfKeys = acfPhpPath ? parseAcfFieldKeysBestEffort(safeReadFile(acfPhpPath)) : [];

      const entry = {
        type,
        id,
        dir,
        phpTemplatePath,
        acfPhpPath,
        previewImagePath,
        acfKeys,
      };

      entries.push(entry);
      if (!byType[type]) byType[type] = { type, variants: [] };
      byType[type].variants.push(entry);
    }
  }

  // Sort variants by id (numeric if possible)
  for (const t of Object.keys(byType)) {
    byType[t].variants.sort((a, b) => {
      const na = Number(a.id);
      const nb = Number(b.id);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  const index = {
    root,
    generatedAt: new Date().toISOString(),
    entries,
    byType,
  };

  if (debug) {
    const counts = {};
    for (const e of entries) counts[e.type] = (counts[e.type] || 0) + 1;
    console.log("[componentLibrary] indexed", {
      root,
      types: Object.keys(counts).length,
      counts,
      entries: entries.length,
    });
  }

  return index;
}

let _singleton = null;

export function initComponentLibrary({
  componentsDir,
  debug = false,
} = {}) {
  if (_singleton) return _singleton;
  _singleton = buildComponentLibraryIndexSync({ componentsDir, debug });
  return _singleton;
}

export function getComponentLibrary() {
  return _singleton;
}


