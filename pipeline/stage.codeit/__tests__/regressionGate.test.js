const path = require("path");
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
};

test("regression gate warns and reverts contract changes", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "gate-test",
    stage: "generate",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\" class=\"w-[10rem]\">Hello</div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  let written = null;
  const evaluateFn = ({ html }) => {
    const isRegressed = String(html || "").includes("regressed");
    const value = isRegressed ? 0.2 : 0.1;
    return {
      diagnostics: {},
      metrics: {
        breakpoints: {
          mobile: { visual: { pixelDiffRatio: { value } } },
          tablet: { visual: { pixelDiffRatio: { value } } },
          desktop: { visual: { pixelDiffRatio: { value } } },
        },
      },
    };
  };

  const contractPath = path.resolve(
    __dirname,
    "../contracts/__tests__/fixtures/regressionContract.js"
  );

  await run({
    slug: "gate-test",
    log: () => {},
    readInputArtifactFn: () => inputArtifact,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    validateTailwindClassesFn: () => ({ warnings: [] }),
    evaluateFn,
    configOverride: {
      contracts: [{ id: "test/regression", path: contractPath, options: {} }],
      gate: { enabled: true, maxVisualDelta: 0.0, revertOnRegression: true },
    },
  });

  assert.ok(written, "artifact should be written");
  const contractResult = written.diagnostics.contracts.results[0];
  assert.equal(contractResult.accepted, false);
  assert.equal(written.diagnostics.ledger.length, 0);
  assert.ok(written.diagnostics.warnings.length >= 1);
});
