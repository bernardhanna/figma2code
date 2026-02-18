import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("hero_v3 visual diff artifact is present with numeric scores", () => {
  const scorePath = path.resolve(
    process.cwd(),
    "generator/fixtures.out/hero_v3/score.desktop.json"
  );
  const raw = fs.readFileSync(scorePath, "utf8");
  const score = JSON.parse(raw);

  assert.equal(score.slug, "hero_v3");
  assert.equal(score.mode, "desktop");
  assert.ok(Number.isFinite(Number(score.diffRatio)), "diffRatio should be numeric");
  assert.ok(Number.isFinite(Number(score.layoutDiffRatio)), "layoutDiffRatio should be numeric");
  assert.ok(score.alignmentSearched === true, "alignment-aware compare should be enabled");
  assert.ok(Number(score.compared?.width) > 0 && Number(score.compared?.height) > 0);
});
