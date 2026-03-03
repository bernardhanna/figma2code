// generator/qa/__tests__/loop.test.js — Smoke test for Visual QA loop (validation and early exit)
import { describe, it } from "node:test";
import assert from "node:assert";
import { runVisualQALoop, shouldRollbackRegression } from "../loop.js";

describe("runVisualQALoop", () => {
  it("returns error when slug is missing", async () => {
    const result = await runVisualQALoop({ port: 5173 });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error || ""), /missing slug/i);
  });

  it("returns error when fetchCompare is missing", async () => {
    const result = await runVisualQALoop({ slug: "test", port: 5173 });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error || ""), /fetchCompare/i);
  });

  it("returns error when no design reference in fixtures.out", async () => {
    const result = await runVisualQALoop({
      slug: "nonexistent-qa-smoke-slug-12345",
      port: 5173,
      fetchCompare: async () => ({ ok: true }),
    });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error || ""), /design reference|figma/i);
  });
});

describe("shouldRollbackRegression", () => {
  it("returns true when current score is worse than last by more than epsilon", () => {
    assert.strictEqual(shouldRollbackRegression(0.9, 0.8, 0.005), true);
    assert.strictEqual(shouldRollbackRegression(0.85, 0.84, 0.005), true);
  });

  it("returns false when current score is better or within epsilon", () => {
    assert.strictEqual(shouldRollbackRegression(0.8, 0.85, 0.005), false);
    assert.strictEqual(shouldRollbackRegression(0.9, 0.896, 0.005), false);
    assert.strictEqual(shouldRollbackRegression(0.9, 0.895, 0.005), false);
  });

  it("returns false when last or current is non-finite", () => {
    assert.strictEqual(shouldRollbackRegression(NaN, 0.8, 0.005), false);
    assert.strictEqual(shouldRollbackRegression(0.9, NaN, 0.005), false);
  });
});
