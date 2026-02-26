import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { layoutIntentV2Pass } from "../layoutIntentV2Pass.js";
import { autoLayoutify } from "../autoLayoutify/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name) {
  const fixturePath = path.join(__dirname, "fixtures", name);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

test("already-good explicit auto layout keeps row output through LayoutModel", () => {
  const ast = loadFixture("layoutModel-already-good.ast.json");

  layoutIntentV2Pass(ast);
  assert.equal(ast.tree.__layoutModel?.layoutType, "row");

  const html = autoLayoutify(ast, { wrap: false });
  assert.match(html, /\bmd:flex-row\b/i);
  assert.doesNotMatch(html, /\bmd:grid-cols-/i);
});

test("messy figma flags still infer row from geometry and codegen follows LayoutModel", () => {
  const ast = loadFixture("layoutModel-messy-flags.ast.json");

  layoutIntentV2Pass(ast);
  assert.equal(ast.tree.__layoutModel?.layoutType, "row");
  assert.equal(ast.tree.__layoutPriors?.figma?.layout, "NONE");

  const html = autoLayoutify(ast, { wrap: false });
  assert.match(html, /\bmd:flex-row\b/i);
  assert.doesNotMatch(html, /\bmd:grid-cols-/i);
});
