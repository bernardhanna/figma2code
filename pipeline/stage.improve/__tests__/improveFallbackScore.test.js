const test = require("node:test");
const assert = require("node:assert/strict");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION } = require("../../artifacts/validate");
const { run } = require("../run");

test("artifact.metrics includes fallbackScore when visual score missing", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "fallback-score",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"root\" class=\"w-full\"><div data-key=\"card\" class=\"h-[8rem] overflow-x-auto w-[10rem] max-w-[20rem]\">content</div></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {},
  };

  let written = null;

  const evaluateFn = () => ({
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: {
          visual: { pixelDiffRatio: { value: null } },
          layout: { fixedHeightWrapperCount: 1, overflowXCount: 1, conflictingWidthCount: 1 },
        },
        tablet: {
          visual: { pixelDiffRatio: { value: null } },
          layout: { fixedHeightWrapperCount: 1, overflowXCount: 1, conflictingWidthCount: 1 },
        },
        desktop: {
          visual: { pixelDiffRatio: { value: null } },
          layout: { fixedHeightWrapperCount: 1, overflowXCount: 1, conflictingWidthCount: 1 },
        },
      },
      offenders: [],
    },
  });

  await run({
    slug: "fallback-score",
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    configOverride: { requireVisualDiff: false },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  assert.equal(typeof written.metrics.fallbackScore, "number");
  assert.ok(written.metrics.fallbackScore >= 0 && written.metrics.fallbackScore <= 100);
});

test("score gate uses fallback when visual missing and rejects regression", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "fallback-gate",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"n1\" class=\"w-full\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {},
  };

  let written = null;
  let evalCount = 0;

  const evaluateFn = ({ html }) => {
    evalCount += 1;
    const layout = { fixedHeightWrapperCount: 0, overflowXCount: 0, conflictingWidthCount: 0 };
    if (String(html || "").includes("badge")) {
      layout.overflowXCount = 5;
      layout.conflictingWidthCount = 2;
    }
    return {
      diagnostics: {},
      metrics: {
        breakpoints: {
          mobile: { visual: { pixelDiffRatio: { value: null } }, layout },
          tablet: { visual: { pixelDiffRatio: { value: null } }, layout },
          desktop: { visual: { pixelDiffRatio: { value: null } }, layout },
        },
        offenders: [],
      },
    };
  };

  const generatePatchPlanFn = ({ iteration }) => ({
    entries: [
      {
        patch: {
          nodeId: "n1",
          selector: "[data-key=\"n1\"]",
          stage: "improve",
          iteration,
          ops: {
            classAdd: ["badge"],
            classRemove: [],
            classReplace: {},
            attrAdd: {},
            attrRemove: [],
          },
        },
        ledgerEntries: [{ op: "classAdd", value: "badge", reason: "test" }],
        seenOps: new Set(),
      },
    ],
    diagnostics: [],
    warnings: [],
  });

  await run({
    slug: "fallback-gate",
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn,
    configOverride: {
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: true },
    },
    log: () => {},
  });

  assert.ok(written);
  assert.equal(typeof written.metrics.fallbackScore, "number");
  assert.ok(written.diagnostics.warnings.some((w) => String(w.message || "").includes("Score gate")), "should have score gate warning when fallback rejects");
});
