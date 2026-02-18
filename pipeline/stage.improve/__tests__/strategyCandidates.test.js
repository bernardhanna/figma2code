const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION } = require("../../artifacts/validate");
const { run } = require("../run");

const fixtureHtml = fs.readFileSync(
  path.join(__dirname, "fixtures", "widthFill.fixture.html"),
  "utf8"
);

test("rules provider proposes and accepts width fill strategy patch", async () => {
  const slug = "improve-strategy-width-fill";
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: fixtureHtml,
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: { visual: { pixelDiffRatio: { value: 0.2 } } },
        tablet: { visual: { pixelDiffRatio: { value: 0.2 } } },
        desktop: { visual: { pixelDiffRatio: { value: 0.2 } } },
      },
      offenders: [],
    },
  };

  let written = null;
  const evaluateFn = ({ html }) => {
    const out = String(html || "");
    const improved =
      out.includes("self-stretch") &&
      out.includes("w-full") &&
      !out.includes("w-[20rem]");
    const value = improved ? 0.1 : 0.2;
    return {
      diagnostics: {},
      metrics: {
        breakpoints: {
          mobile: { visual: { pixelDiffRatio: { value } } },
          tablet: { visual: { pixelDiffRatio: { value } } },
          desktop: { visual: { pixelDiffRatio: { value } } },
        },
        offenders: improved
          ? []
          : [
              {
                kind: "width",
                category: "layout",
                nodeId: "node-1",
                selector: "[data-key=\"node-1\"]",
                hint: "CTA should fill parent width",
                breakpoint: "desktop",
                pixels: 1800,
                suggestedContract: "layout/width/enforceWidthIntent",
              },
            ],
      },
    };
  };

  await run({
    slug,
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    log: () => {},
    configOverride: {
      provider: "rules",
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: true },
    },
  });

  assert.ok(written, "artifact should be written");
  assert.ok(Array.isArray(written.patches) && written.patches.length >= 1, "at least one patch expected");
  assert.ok(
    Number(written?.diagnostics?.patchPlan?.generated || 0) >= 1,
    "at least one patch candidate should be generated"
  );
  assert.ok(
    Number(written?.diagnostics?.patchPlan?.accepted || 0) >= 1,
    "at least one patch should be accepted"
  );
  const strategyStats = Array.isArray(written?.diagnostics?.patchPlan?.strategyStats)
    ? written.diagnostics.patchPlan.strategyStats
    : [];
  const widthStrategy = strategyStats.find((s) => s.name === "layout-width-fill");
  assert.ok(widthStrategy, "width strategy stats should be present");
  assert.ok(Number(widthStrategy.candidateOps || 0) >= 1, "width strategy should generate candidate ops");
});

test("rules provider applies a11y contrast guard on dark button background", async () => {
  const slug = "improve-strategy-a11y-contrast-guard";
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: `<section><button data-key="cta" class="btn bg-[#0f172a] px-6 py-3">Book</button></section>`,
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: { visual: { pixelDiffRatio: { value: 0.2 } } },
        tablet: { visual: { pixelDiffRatio: { value: 0.2 } } },
        desktop: { visual: { pixelDiffRatio: { value: 0.2 } } },
      },
      offenders: [],
    },
  };

  let written = null;
  const evaluateFn = ({ html }) => {
    const out = String(html || "");
    const improved = /\btext-white\b/.test(out);
    const value = improved ? 0.1 : 0.2;
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

  await run({
    slug,
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    log: () => {},
    configOverride: {
      provider: "rules",
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: true },
    },
  });

  assert.ok(written, "artifact should be written");
  assert.ok(Array.isArray(written.patches) && written.patches.length === 1, "exactly one patch expected");
  const contrastPatch = written.patches[0];
  assert.equal(contrastPatch?.nodeId, "cta");
  assert.deepEqual(contrastPatch?.ops?.classAdd || [], ["text-white"]);
  assert.deepEqual(contrastPatch?.ops?.classRemove || [], []);
  assert.deepEqual(contrastPatch?.ops?.attrRemove || [], []);
  const strategyStats = Array.isArray(written?.diagnostics?.patchPlan?.strategyStats)
    ? written.diagnostics.patchPlan.strategyStats
    : [];
  const contrastStrategy = strategyStats.find((s) => s.name === "a11y-contrast-guard");
  assert.ok(contrastStrategy, "contrast guard strategy stats should be present");
  assert.ok(Number(contrastStrategy.candidateOps || 0) >= 1, "contrast guard should generate candidate ops");
});

test("rules provider does not add contrast patch on light button background", async () => {
  const slug = "improve-strategy-a11y-contrast-guard-light";
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: `<section><button data-key="cta-light" class="btn bg-[#f9fafb] px-6 py-3">Book</button></section>`,
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: { visual: { pixelDiffRatio: { value: 0.2 } } },
        tablet: { visual: { pixelDiffRatio: { value: 0.2 } } },
        desktop: { visual: { pixelDiffRatio: { value: 0.2 } } },
      },
      offenders: [],
    },
  };

  let written = null;
  const evaluateFn = ({ html }) => ({
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: { visual: { pixelDiffRatio: { value: 0.2 } } },
        tablet: { visual: { pixelDiffRatio: { value: 0.2 } } },
        desktop: { visual: { pixelDiffRatio: { value: 0.2 } } },
      },
      offenders: [],
    },
  });

  await run({
    slug,
    evaluateFn,
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    log: () => {},
    configOverride: {
      provider: "rules",
      requireVisualDiff: false,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false },
    },
  });

  assert.ok(written, "artifact should be written");
  assert.ok(Array.isArray(written.patches) && written.patches.length === 0, "no contrast patch should be added");
  assert.ok(!/\btext-white\b/.test(written.html), "text-white must not be injected for light background");
  const strategyStats = Array.isArray(written?.diagnostics?.patchPlan?.strategyStats)
    ? written.diagnostics.patchPlan.strategyStats
    : [];
  const contrastStrategy = strategyStats.find((s) => s.name === "a11y-contrast-guard");
  assert.ok(!contrastStrategy, "contrast guard should not run on light background");
});

test("contrast guard still runs when visual diff is unavailable", async () => {
  const slug = "improve-strategy-a11y-contrast-guard-no-visual";
  const inputArtifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "codeit",
    createdAt: new Date().toISOString(),
    html: `<section><button data-key="cta-no-visual" class="btn text-center bg-[#0f172a] px-6 py-3">Book</button></section>`,
    patches: [],
    assets: {},
    diagnostics: {},
    metrics: {
      breakpoints: {
        mobile: { visual: { pixelDiffRatio: { value: null, source: "placeholder" } } },
        tablet: { visual: { pixelDiffRatio: { value: null, source: "placeholder" } } },
        desktop: { visual: { pixelDiffRatio: { value: null, source: "placeholder" } } },
      },
      offenders: [],
    },
  };

  let written = null;
  const evaluateFn = ({ html }) => {
    const out = String(html || "");
    const improved = /\btext-white\b/.test(out);
    return {
      diagnostics: {
        visualDiff: {
          missing: [
            { breakpoint: "mobile", reason: "missing-score-files", searched: {} },
            { breakpoint: "tablet", reason: "missing-score-files", searched: {} },
            { breakpoint: "desktop", reason: "missing-score-files", searched: {} },
          ],
        },
      },
      metrics: {
        breakpoints: {
          mobile: { visual: { pixelDiffRatio: { value: improved ? 0.1 : null, source: improved ? "score" : "placeholder" } } },
          tablet: { visual: { pixelDiffRatio: { value: improved ? 0.1 : null, source: improved ? "score" : "placeholder" } } },
          desktop: { visual: { pixelDiffRatio: { value: improved ? 0.1 : null, source: improved ? "score" : "placeholder" } } },
        },
        offenders: [],
      },
    };
  };

  await run({
    slug,
    evaluateFn,
    ensureVisualDiffFn: async () => ({ ok: false, error: "compare unavailable" }),
    readInputArtifactFn: () => inputArtifact,
    readExistingArtifactFn: () => null,
    writeArtifactFn: (_slug, artifact) => {
      written = artifact;
    },
    writeHistorySnapshotFn: () => {},
    log: () => {},
    configOverride: {
      provider: "rules",
      requireVisualDiff: true,
      gate: { enabled: true, maxVisualDelta: 0, requireImprovement: false },
    },
  });

  assert.ok(written, "artifact should be written");
  assert.ok(Array.isArray(written.patches) && written.patches.length === 1, "contrast guard patch should still be proposed");
  const contrastPatch = written.patches[0];
  assert.equal(contrastPatch?.nodeId, "cta-no-visual");
  assert.deepEqual(contrastPatch?.ops?.classAdd || [], ["text-white"]);
});
