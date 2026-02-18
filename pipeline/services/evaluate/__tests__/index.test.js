const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { evaluate } = require("../index");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const OUT_ROOT = path.join(REPO_ROOT, "fixtures.out");
const GENERATOR_OUT_ROOT = path.join(REPO_ROOT, "generator", "fixtures.out");

function rmDirIfExists(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

test("evaluate reads score files from generator/fixtures.out when repo fixtures are absent", () => {
  const slug = "_eval_score_from_generator_dir";
  const repoDir = path.join(OUT_ROOT, slug);
  const generatorDir = path.join(GENERATOR_OUT_ROOT, slug);
  rmDirIfExists(repoDir);
  rmDirIfExists(generatorDir);
  fs.mkdirSync(generatorDir, { recursive: true });

  const scoreDesktop = {
    diffRatio: 0.0123,
    diffPixels: 123,
    totalPixels: 10000,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(generatorDir, "score.desktop.json"),
    JSON.stringify(scoreDesktop, null, 2),
    "utf8"
  );

  try {
    const out = evaluate({ slug, html: "<div id='cmp_root'></div>" });
    const metric = out?.metrics?.breakpoints?.desktop?.visual?.pixelDiffRatio;
    assert.equal(typeof metric?.value, "number");
    assert.equal(metric.value, scoreDesktop.diffRatio);
    assert.equal(metric.source, "visual-diff");
  } finally {
    rmDirIfExists(repoDir);
    rmDirIfExists(generatorDir);
  }
});

test("evaluate emits actionable diagnostics when visual diff prerequisites are missing", () => {
  const slug = "_eval_missing_visual_diff_diag";
  const repoDir = path.join(OUT_ROOT, slug);
  const generatorDir = path.join(GENERATOR_OUT_ROOT, slug);
  rmDirIfExists(repoDir);
  rmDirIfExists(generatorDir);

  const out = evaluate({ slug, html: "<div id='cmp_root'></div>" });
  const missing = out?.diagnostics?.visualDiff?.missing || [];
  assert.equal(Array.isArray(missing), true);
  assert.equal(missing.length, 3);
  missing.forEach((entry) => {
    assert.equal(typeof entry.breakpoint, "string");
    assert.equal(typeof entry.reason, "string");
    assert.ok(Array.isArray(entry?.searched?.scoreFiles));
    assert.ok(Array.isArray(entry?.searched?.figmaFiles));
    assert.ok(Array.isArray(entry?.searched?.renderFiles));
  });
});
