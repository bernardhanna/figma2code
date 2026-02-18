// generator/qa/__tests__/aiTieBreaker.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  validatePatchSchema,
  validateClassOnly,
  validatePatchKeyCount,
  buildAllowedKeys,
  selectFixWithAI,
} from "../aiTieBreaker.js";

describe("validatePatchSchema", () => {
  it("accepts valid classAdd patch", () => {
    const r = validatePatchSchema({ targetKey: "btn#1", op: "classAdd", classes: ["w-full"] });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.patch, { targetKey: "btn#1", op: "classAdd", classes: ["w-full"] });
  });

  it("rejects null patch", () => {
    const r = validatePatchSchema(null);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /object/);
  });

  it("rejects array", () => {
    const r = validatePatchSchema([]);
    assert.strictEqual(r.ok, false);
  });

  it("rejects missing targetKey", () => {
    const r = validatePatchSchema({ op: "classAdd", classes: ["w-full"] });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /targetKey/);
  });

  it("rejects invalid op", () => {
    const r = validatePatchSchema({ targetKey: "x", op: "setTag", classes: [] });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /classAdd|classRemove|classReplace/);
  });

  it("rejects non-array classes", () => {
    const r = validatePatchSchema({ targetKey: "x", op: "classAdd", classes: "w-full" });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /array/);
  });

  it("rejects classReplace with odd number of classes", () => {
    const r = validatePatchSchema({ targetKey: "x", op: "classReplace", classes: ["a", "b", "c"] });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /even/);
  });
});

describe("validateClassOnly", () => {
  it("accepts patch with only targetKey, op, classes", () => {
    assert.strictEqual(validateClassOnly({ targetKey: "x", op: "classAdd", classes: [] }), true);
  });

  it("rejects patch with extra fields", () => {
    assert.strictEqual(
      validateClassOnly({ targetKey: "x", op: "classAdd", classes: [], tag: "button" }),
      false
    );
    assert.strictEqual(
      validateClassOnly({ targetKey: "x", op: "classAdd", classes: [], structure: true }),
      false
    );
  });
});

describe("validatePatchKeyCount", () => {
  it("accepts up to MAX_PATCH_KEYS unique keys in allowed set", () => {
    const patches = [
      { targetKey: "a", op: "classAdd", classes: ["w-full"] },
      { targetKey: "b", op: "classAdd", classes: ["block"] },
    ];
    const allowed = new Set(["a", "b"]);
    const r = validatePatchKeyCount(patches, allowed);
    assert.strictEqual(r.ok, true);
  });

  it("rejects patches with more than MAX_PATCH_KEYS unique targetKeys", () => {
    const patches = [
      { targetKey: "a", op: "classAdd", classes: ["x"] },
      { targetKey: "b", op: "classAdd", classes: ["y"] },
      { targetKey: "c", op: "classAdd", classes: ["z"] },
      { targetKey: "d", op: "classAdd", classes: ["w"] },
    ];
    const allowed = new Set(["a", "b", "c", "d"]);
    const r = validatePatchKeyCount(patches, allowed);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /at most 3|target keys/);
  });

  it("rejects targetKey not in allowedKeys", () => {
    const patches = [{ targetKey: "x", op: "classAdd", classes: ["w-full"] }];
    const allowed = new Set(["y"]);
    const r = validatePatchKeyCount(patches, allowed);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /allowed/);
  });

  it("rejects empty patches array", () => {
    const r = validatePatchKeyCount([], new Set(["a"]));
    assert.strictEqual(r.ok, false);
  });

  it("rejects more than MAX_PATCHES_PER_CALL patches", () => {
    const patches = Array.from({ length: 6 }, (_, i) => ({
      targetKey: "a",
      op: "classAdd",
      classes: [`c${i}`],
    }));
    const r = validatePatchKeyCount(patches, new Set(["a"]));
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /at most 5|patches/);
  });
});

describe("buildAllowedKeys", () => {
  it("includes targetKey and parent from layout", () => {
    const bundles = [{ issue: { targetKey: "child" } }];
    const layout = [
      { nodeId: "parent-id", dataKey: "parent", parentNodeId: null },
      { nodeId: "child-id", dataKey: "child", parentNodeId: "parent-id" },
    ];
    const keys = buildAllowedKeys(bundles, layout);
    assert.ok(keys.has("child"));
    assert.ok(keys.has("parent"));
  });
});

describe("selectFixWithAI", () => {
  it("returns fallback patches when aiClient throws", async () => {
    const bundles = [
      { issue: { targetKey: "btn#1" }, suggestedFix: { op: "classAdd", classes: ["w-full"] } },
    ];
    const evidence = { expectedRects: {}, outputRects: {}, offenders: [], layout: [], breakpoint: "desktop" };
    const badClient = {
      complete: async () => {
        throw new Error("network");
      },
    };
    const result = await selectFixWithAI(bundles, evidence, badClient, {
      allowedKeys: new Set(["btn#1"]),
    });
    assert.strictEqual(result.usedAI, false);
    assert.strictEqual(result.patches.length, 1);
    assert.strictEqual(result.patches[0].targetKey, "btn#1");
    assert.deepStrictEqual(result.patches[0].classes, ["w-full"]);
  });

  it("returns fallback when AI returns invalid JSON", async () => {
    const bundles = [
      { issue: { targetKey: "btn#1" }, suggestedFix: { op: "classAdd", classes: ["w-full"] } },
    ];
    const evidence = { expectedRects: {}, outputRects: {}, offenders: [], layout: [], breakpoint: "desktop" };
    const client = {
      complete: async () => ({ text: "not json at all" }),
    };
    const result = await selectFixWithAI(bundles, evidence, client, {
      allowedKeys: new Set(["btn#1"]),
    });
    assert.strictEqual(result.usedAI, false);
    assert.strictEqual(result.patches.length, 1);
  });

  it("returns fallback when AI returns malformed patch schema", async () => {
    const bundles = [
      { issue: { targetKey: "btn#1" }, suggestedFix: { op: "classAdd", classes: ["w-full"] } },
    ];
    const evidence = { expectedRects: {}, outputRects: {}, offenders: [], layout: [], breakpoint: "desktop" };
    const client = {
      complete: async () => ({
        text: JSON.stringify({
          patches: [{ targetKey: "btn#1", op: "invalidOp", classes: ["w-full"] }],
          reasoning: "test",
        }),
      }),
    };
    const result = await selectFixWithAI(bundles, evidence, client, {
      allowedKeys: new Set(["btn#1"]),
    });
    assert.strictEqual(result.usedAI, false);
    assert.strictEqual(result.patches.length, 1);
    assert.strictEqual(result.patches[0].targetKey, "btn#1");
  });

  it("returns fallback when AI returns targetKey not in allowedKeys", async () => {
    const bundles = [
      { issue: { targetKey: "btn#1" }, suggestedFix: { op: "classAdd", classes: ["w-full"] } },
    ];
    const evidence = { expectedRects: {}, outputRects: {}, offenders: [], layout: [], breakpoint: "desktop" };
    const client = {
      complete: async () => ({
        text: JSON.stringify({
          patches: [{ targetKey: "other-key", op: "classAdd", classes: ["w-full"] }],
          reasoning: "test",
        }),
      }),
    };
    const result = await selectFixWithAI(bundles, evidence, client, {
      allowedKeys: new Set(["btn#1"]),
    });
    assert.strictEqual(result.usedAI, false);
    assert.strictEqual(result.patches[0].targetKey, "btn#1");
  });
});
