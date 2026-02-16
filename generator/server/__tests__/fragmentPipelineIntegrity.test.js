import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertMergedHtmlIntegrity } from "../fragmentPipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("integrity guard throws on duplicate root/data-node-id blocks", () => {
  const fixture = path.join(__dirname, "fixtures", "duplicatedRoots.html");
  const html = fs.readFileSync(fixture, "utf8");
  assert.throws(
    () => assertMergedHtmlIntegrity(html),
    /MERGE_INTEGRITY_DUPLICATE_DATA_NODE_ID|MERGE_INTEGRITY_DUPLICATE_ROOT_KEY/
  );
});

test("integrity guard passes for single-root document", () => {
  const html = `<section><div data-node-id="x1" data-key="root" class="w-full max-w-[80rem] mx-auto">A</div></section>`;
  assert.doesNotThrow(() => assertMergedHtmlIntegrity(html));
});

test("integrity guard throws on multiple top-level root signatures", () => {
  const html = `<div class="w-full max-w-[80rem] mx-auto">A</div><div class="w-full max-w-[80rem] mx-auto">B</div>`;
  assert.throws(
    () => assertMergedHtmlIntegrity(html),
    /MERGE_INTEGRITY_MULTIPLE_TOP_LEVEL_ROOTS/
  );
});

