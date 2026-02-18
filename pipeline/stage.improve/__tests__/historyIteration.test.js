const test = require("node:test");
const assert = require("node:assert/strict");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION } = require("../../artifacts/validate");
const { run } = require("../run");

const baseMetrics = {
  breakpoints: {
    mobile: { visual: { pixelDiffRatio: { value: 0.1 } } },
    tablet: { visual: { pixelDiffRatio: { value: 0.1 } } },
    desktop: { visual: { pixelDiffRatio: { value: 0.1 } } },
  },
  offenders: [],
};

test("history iteration increments and writes snapshot", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-history",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  const existingArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-history",
    stage: "improve",
    createdAt: new Date().toISOString(),
    html: inputArtifact.html,
    patches: [{ nodeId: "node-1", ops: { classAdd: ["text-sm"] } }],
    assets: {},
    diagnostics: {
      iteration: 1,
      history: [{ iteration: 1, createdAt: new Date().toISOString() }],
    },
    metrics: baseMetrics,
  };

  let historyCall = null;
  let written = null;

  const evaluateFn = () => ({
    diagnostics: {},
    metrics: baseMetrics,
  });

  await run({
    slug: "improve-history",
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => existingArtifact,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: (slug, iteration, snapshot) => {
      historyCall = { slug, iteration, snapshot };
    },
    generatePatchPlanFn: () => ({ entries: [], diagnostics: [], warnings: [] }),
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  assert.equal(written.diagnostics.iteration, 2);
  assert.equal(written.diagnostics.history.length, 2);
  assert.ok(historyCall);
  assert.equal(historyCall.iteration, 2);
});
