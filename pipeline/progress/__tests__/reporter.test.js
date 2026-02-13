const test = require("node:test");
const assert = require("node:assert/strict");
const { createReporter } = require("../reporter");
const { CODEIT, codeitContractStep } = require("../steps");

test("reporter succeed appends ✓ line and emits success event", () => {
  const lines = [];
  const reporter = createReporter((line) => lines.push(line));
  reporter.succeed(CODEIT.LOAD_ARTIFACT);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "✓ " + CODEIT.LOAD_ARTIFACT);
  const events = reporter.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "success");
  assert.equal(events[0].label, CODEIT.LOAD_ARTIFACT);
});

test("reporter writeSummary includes Warnings & Errors, Fixes, Artifacts, Score", () => {
  const lines = [];
  const reporter = createReporter((line) => lines.push(line));
  reporter.succeed(CODEIT.DONE);
  reporter.writeSummary({
    errors: [],
    warnings: [{ message: "one" }],
    fixCount: 5,
    fixGroups: [{ reason: "Removed duplicate tokens", count: 5, nodes: [] }],
    formatFixLine: (g) => (g.reason && g.count ? `Removed ${g.count} ${g.reason}.` : ""),
    artifactsPath: "/out/artifact.codeit.json",
    scorePerBreakpoint: { mobile: "—", tablet: "—", desktop: "—" },
  });
  const log = reporter.getLog();
  assert.ok(log.includes("Warnings & Errors (Errors: 0, Warnings: 1)"));
  assert.ok(log.includes("Fixes: 5"));
  assert.ok(log.includes("Artifacts written: /out/artifact.codeit.json"));
  assert.ok(log.includes("Score per breakpoint:"));
  assert.ok(log.includes("- mobile: —"));
});

test("codeitContractStep returns Contract: <id>…", () => {
  assert.equal(codeitContractStep("layout/height/removeFixedHeights"), "Contract: layout/height/removeFixedHeights…");
  assert.equal(codeitContractStep(""), null);
});

test("reporter writeImproveSummary includes offenders, proposed/accepted/rejected, rejection reasons", () => {
  const lines = [];
  const reporter = createReporter((line) => lines.push(line));
  reporter.writeImproveSummary({
    offendersFound: 5,
    patchesProposed: 3,
    patchesAccepted: 1,
    patchesRejected: 2,
    rejectionReasonGroups: [
      { reason: "Patch has no bounded ops.", count: 1, nodeIds: ["node-1"] },
      { reason: "blocked: protected media/hero height", count: 1, nodeIds: ["frame:hero#1"] },
    ],
    noPatchesAcceptedMessage: undefined,
  });
  const log = reporter.getLog();
  assert.ok(log.includes("Improve summary:"));
  assert.ok(log.includes("Offenders found: 5"));
  assert.ok(log.includes("Patches proposed: 3 | accepted: 1 | rejected: 2"));
  assert.ok(log.includes("Rejected (1): Patch has no bounded ops. [node-1]"));
  assert.ok(log.includes("Rejected (1): blocked: protected media/hero height [frame:hero#1]"));
});

test("reporter writeSummary with fallbackScore appends Fallback score line", () => {
  const lines = [];
  const reporter = createReporter((line) => lines.push(line));
  reporter.writeSummary({
    errors: [],
    warnings: [],
    fixCount: 0,
    fixGroups: [],
    artifactsPath: "/out/artifact.improve.json",
    scorePerBreakpoint: { mobile: "—", tablet: "—", desktop: "—" },
    fallbackScore: 82,
  });
  const log = reporter.getLog();
  assert.ok(log.includes("Fixes: 0"));
  assert.ok(log.includes("Fallback score: 82"));
});
