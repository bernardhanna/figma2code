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

test("score gate rejects regressing patches", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-gate",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\" class=\"w-[10rem]\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  let written = null;

  const evaluateFn = ({ html }) => {
    const isRegressed = String(html || "").includes("regress");
    const value = isRegressed ? 0.2 : 0.1;
    return {
      diagnostics: {},
      metrics: {
        breakpoints: {
          mobile: { visual: { pixelDiffRatio: { value } } },
          tablet: { visual: { pixelDiffRatio: { value } } },
          desktop: { visual: { pixelDiffRatio: { value } } },
        },
        offenders: [],
      },
    };
  };

  const generatePatchPlanFn = ({ iteration }) => ({
    entries: [
      {
        patch: {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          stage: "improve",
          iteration,
          ops: {
            classAdd: ["regress"],
            classRemove: [],
            classReplace: {},
            attrAdd: {},
            attrRemove: [],
          },
        },
        ledgerEntries: [
          {
            contractId: "improve",
            nodeId: "node-1",
            selector: "[data-key=\"node-1\"]",
            op: "classAdd",
            value: "regress",
            reason: "Patch: added regress (test)",
          },
        ],
        seenOps: new Set(),
      },
    ],
    diagnostics: [],
    warnings: [],
  });

  await run({
    slug: "improve-gate",
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn,
    configOverride: {
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: true },
    },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  assert.equal(written.patches.length, 0);
  assert.equal(written.diagnostics.ledger.length, 0);
  assert.ok(written.diagnostics.warnings.length >= 1);
});
