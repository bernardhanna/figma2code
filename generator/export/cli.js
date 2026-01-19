#!/usr/bin/env node
// generator/export/cli.js
import process from "node:process";

import { exportComponent } from "./index.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    out[key.replace(/^--/, "")] = value;
    i += 1;
  }
  return out;
}

function usage() {
  return (
    "Usage: node export/cli.js --slug <slug> --type <type> [--componentsRoot <path>]\n" +
    "Example: node export/cli.js --slug hero_v3 --type hero --componentsRoot ../components"
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const slug = String(args.slug || "").trim();
  const type = String(args.type || "").trim();
  const componentsRoot = String(args.componentsRoot || "").trim();

  if (!slug || !type) {
    console.error(usage());
    process.exit(1);
  }

  try {
    const result = await exportComponent({
      slug,
      type,
      componentsRoot: componentsRoot || undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

run();

