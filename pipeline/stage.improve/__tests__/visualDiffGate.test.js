const test = require("node:test");
const assert = require("node:assert/strict");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION } = require("../../artifacts/validate");
const { run } = require("../run");

test("skips improve iteration when visual diff stays placeholder", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-no-visual",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"root\" class=\"w-full\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {},
  };

  let wrote = null;
  let generateCalled = false;

  const evaluateFn = () => ({
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: { visual: { pixelDiffRatio: { value: null, source: "placeholder" } } },
        tablet: { visual: { pixelDiffRatio: { value: null, source: "placeholder" } } },
        desktop: { visual: { pixelDiffRatio: { value: null, source: "placeholder" } } },
      },
      offenders: [
        {
          nodeId: "root",
          selector: "[data-key=\"root\"]",
          category: "layout",
          hint: "Conflicting width utilities",
          suggestedContract: "layout/width/dedupeWidths",
        },
      ],
    },
  });

  await run({
    slug: "improve-no-visual",
    evaluateFn,
    ensureVisualDiffFn: async () => ({ ok: false, error: "compare unavailable" }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      wrote = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => {
      generateCalled = true;
      return { entries: [], diagnostics: [], warnings: [] };
    },
    log: () => {},
  });

  assert.ok(wrote, "artifact should be written");
  assert.equal(generateCalled, false, "plan generation should be skipped");
  assert.equal(wrote.diagnostics.patchPlan.skippedReason, "no-visual-diff");
  assert.equal(wrote.diagnostics.patchPlan.generated, 0);
  assert.ok(
    wrote.diagnostics.warnings.some((w) => String(w.message || "").includes("no patches generated")),
    "should include actionable skip warning"
  );
});
