const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION } = require("../../artifacts/validate");
const { run } = require("../run");

const baseMetrics = {
  breakpoints: {
    mobile: { visual: { pixelDiffRatio: { value: 0.2 } } },
    tablet: { visual: { pixelDiffRatio: { value: 0.2 } } },
    desktop: { visual: { pixelDiffRatio: { value: 0.2 } } },
  },
  offenders: [],
};

const noopPatch = {
  nodeId: "node-1",
  selector: "[data-key=\"node-1\"]",
  ops: { classAdd: ["text-sm"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
};

test("improve rejects no-op patch before visual gate trial", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-thrash-noop",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\" class=\"text-sm\">A</div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-thrash-noop",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({ patches: [noopPatch], diagnostics: [], warnings: [] }),
    configOverride: { requireVisualDiff: false, gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false } },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  const groups = Array.isArray(written?.diagnostics?.rejectionReasonGroups)
    ? written.diagnostics.rejectionReasonGroups
    : [];
  assert.ok(
    groups.some((g) => /no-op patch \(no DOM change\)/i.test(String(g?.reason || ""))),
    "no-op rejection reason should be recorded"
  );
});

test("improve skips previously rejected patch signature from recent history", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-thrash-history-skip",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\">A</div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  const existingArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-thrash-history-skip",
    stage: "improve",
    createdAt: new Date().toISOString(),
    html: inputArtifact.html,
    patches: [],
    assets: {},
    diagnostics: {
      iteration: 1,
      history: [
        {
          iteration: 1,
          rejectedByGate: [{ patch: noopPatch, reason: "Score gate: no visual improvement detected." }],
        },
      ],
    },
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-thrash-history-skip",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => existingArtifact,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({ patches: [noopPatch], diagnostics: [], warnings: [] }),
    configOverride: { requireVisualDiff: false, gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false } },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  const groups = Array.isArray(written?.diagnostics?.rejectionReasonGroups)
    ? written.diagnostics.rejectionReasonGroups
    : [];
  assert.ok(
    groups.some((g) => /Previously rejected patch signature/i.test(String(g?.reason || ""))),
    "history signature skip reason should be recorded"
  );
});

test("improve caps repeated rejected trials per node within a run", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-thrash-node-cap",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\">A</div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-thrash-node-cap",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({
      patches: [
        {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          ops: { classAdd: ["text-sm"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
        },
        {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          ops: { classAdd: ["text-lg"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
        },
        {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          ops: { classAdd: ["text-xl"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
        },
      ],
      diagnostics: [],
      warnings: [],
    }),
    configOverride: {
      requireVisualDiff: false,
      maxProposedTrialsPerNode: 0,
      maxRejectedTrialsPerNode: 1,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: true },
    },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  const groups = Array.isArray(written?.diagnostics?.rejectionReasonGroups)
    ? written.diagnostics.rejectionReasonGroups
    : [];
  const capGroup = groups.find((g) =>
    /Rejected trial cap reached for node/i.test(String(g?.reason || ""))
  );
  assert.ok(capGroup, "node trial cap reason should be present");
  assert.ok(Number(capGroup.count || 0) >= 1, "cap should skip repeated trials");
});

test("improve caps proposed candidates per node before trial gate", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-thrash-proposed-cap",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\">A</div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-thrash-proposed-cap",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({
      patches: [
        {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          ops: { classAdd: ["text-sm"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
        },
        {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          ops: { classAdd: ["text-lg"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
        },
        {
          nodeId: "node-1",
          selector: "[data-key=\"node-1\"]",
          ops: { classAdd: ["text-xl"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
        },
      ],
      diagnostics: [],
      warnings: [],
    }),
    configOverride: {
      requireVisualDiff: false,
      maxProposedTrialsPerNode: 1,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false },
    },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  const groups = Array.isArray(written?.diagnostics?.rejectionReasonGroups)
    ? written.diagnostics.rejectionReasonGroups
    : [];
  const capGroup = groups.find((g) =>
    /Proposed trial cap reached for node/i.test(String(g?.reason || ""))
  );
  assert.ok(capGroup, "proposed cap reason should be present");
  assert.ok(Number(capGroup.count || 0) >= 2, "proposed cap should skip at least two candidates");
});

test("cleanup-kind patches can pass gate with no visual improvement", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-cleanup-no-regression",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\" class=\"w-full max-w-[20rem]\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-cleanup-no-regression",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({
      entries: [
        {
          patch: {
            nodeId: "node-1",
            selector: "[data-key=\"node-1\"]",
            ops: { classAdd: ["mx-auto"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
          },
          ledgerEntries: [],
          seenOps: new Set(),
          gateKind: "cleanup",
        },
      ],
      diagnostics: [],
      warnings: [],
      strategyStats: [],
    }),
    configOverride: {
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: true },
    },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  assert.ok(Array.isArray(written.patches) && written.patches.length === 1, "cleanup patch should be accepted");
});

test("cooldown skips same node+strategy on unchanged HTML", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-cooldown-skip",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\" class=\"w-full max-w-[20rem]\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };
  const existingArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-cooldown-skip",
    stage: "improve",
    createdAt: new Date().toISOString(),
    html: inputArtifact.html,
    patches: [],
    assets: {},
    diagnostics: {
      iteration: 1,
      history: [
        {
          iteration: 1,
          inputHash: crypto.createHash("sha256").update(JSON.stringify(inputArtifact)).digest("hex"),
          rejectedByGate: [
            {
              patch: {
                nodeId: "node-1",
                selector: "[data-key=\"node-1\"]",
                ops: { classAdd: [], classRemove: ["max-w-[20rem]"], classReplace: {}, attrAdd: {}, attrRemove: [] },
              },
              strategyName: "width-dedupe-smart",
              reason: "Score gate: no visual improvement detected.",
            },
          ],
        },
      ],
    },
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-cooldown-skip",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => existingArtifact,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({
      entries: [
        {
          patch: {
            nodeId: "node-1",
            selector: "[data-key=\"node-1\"]",
            ops: { classAdd: [], classRemove: ["max-w-[20rem]"], classReplace: {}, attrAdd: {}, attrRemove: [] },
          },
          ledgerEntries: [],
          seenOps: new Set(),
          gateKind: "cleanup",
          strategyName: "width-dedupe-smart",
        },
      ],
      diagnostics: [],
      warnings: [],
      strategyStats: [],
    }),
    configOverride: {
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false },
    },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  assert.equal(Array.isArray(written.patches) ? written.patches.length : 0, 0, "patch should be skipped");
  const groups = Array.isArray(written?.diagnostics?.rejectionReasonGroups)
    ? written.diagnostics.rejectionReasonGroups
    : [];
  assert.ok(
    groups.some((g) => /Node-strategy cooldown/i.test(String(g?.reason || ""))),
    "cooldown rejection reason should be recorded"
  );
});

test("cooldown does not block when input artifact changed", async () => {
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-cooldown-changed",
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: "<div data-key=\"node-1\" class=\"w-full max-w-[20rem]\"></div>",
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: baseMetrics,
  };
  const existingArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug: "improve-cooldown-changed",
    stage: "improve",
    createdAt: new Date().toISOString(),
    html: inputArtifact.html,
    patches: [],
    assets: {},
    diagnostics: {
      iteration: 1,
      history: [
        {
          iteration: 1,
          inputHash: "old-hash",
          rejectedByGate: [
            {
              patch: {
                nodeId: "node-1",
                selector: "[data-key=\"node-1\"]",
                ops: { classAdd: [], classRemove: ["max-w-[20rem]"], classReplace: {}, attrAdd: {}, attrRemove: [] },
              },
              strategyName: "width-dedupe-smart",
              reason: "Score gate: no visual improvement detected.",
            },
          ],
        },
      ],
    },
    metrics: baseMetrics,
  };

  let written = null;
  await run({
    slug: "improve-cooldown-changed",
    evaluateFn: () => ({ diagnostics: {}, metrics: baseMetrics }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => existingArtifact,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    generatePatchPlanFn: () => ({
      entries: [
        {
          patch: {
            nodeId: "node-1",
            selector: "[data-key=\"node-1\"]",
            ops: { classAdd: ["mx-auto"], classRemove: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
          },
          ledgerEntries: [],
          seenOps: new Set(),
          gateKind: "cleanup",
          strategyName: "width-dedupe-smart",
        },
      ],
      diagnostics: [],
      warnings: [],
      strategyStats: [],
    }),
    configOverride: {
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false },
    },
    log: () => {},
  });

  assert.ok(written, "artifact should be written");
  assert.equal(Array.isArray(written.patches) ? written.patches.length : 0, 1, "patch should be allowed");
});

