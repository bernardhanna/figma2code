import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateImprovement } from "../refineGate.js";
import { patchesScript } from "../../templates/preview/preview.patches.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

test("acceptance gating rejects negative improvement", () => {
  const out = evaluateImprovement({
    beforeDiff: 0.42,
    afterDiff: 0.431,
    epsilon: 0.0005,
  });
  assert.equal(out.accept, false);
  assert.ok(out.improvedBy < 0);
});

test("preview patches script exposes PATCHES_READY flags", () => {
  const script = String(patchesScript() || "");
  assert.ok(script.includes("__PATCHES_READY__"));
  assert.ok(script.includes("__PATCHES_APPLIED_COUNT__"));
});

test("visual diff screenshot waits for PATCHES_READY", () => {
  const sourcePath = path.join(ROOT, "server", "visualDiffScreenshot.js");
  const src = fs.readFileSync(sourcePath, "utf8");
  assert.match(src, /waitForFunction\(\(\)\s*=>\s*window\.__PATCHES_READY__\s*===\s*true/);
});
