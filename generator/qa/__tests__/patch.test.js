// generator/qa/__tests__/patch.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createPatch,
  resolveToNodeId,
  mergePatchIntoMap,
  mergePatchesMap,
  applyPatchesToMap,
} from "../patch.js";

describe("patch", () => {
  it("createPatch normalizes op and classes", () => {
    const p = createPatch({ targetKey: "btn#1", op: "classAdd", classes: ["w-full", "  block  "] });
    assert.strictEqual(p.targetKey, "btn#1");
    assert.strictEqual(p.op, "classAdd");
    assert.deepStrictEqual(p.classes, ["w-full", "block"]);
  });

  it("resolveToNodeId finds by dataKey then nodeId", () => {
    const layout = [
      { nodeId: "n1", dataKey: "instance:button#1" },
      { nodeId: "n2", dataKey: "" },
    ];
    assert.strictEqual(resolveToNodeId(layout, "instance:button#1"), "n1");
    assert.strictEqual(resolveToNodeId(layout, "n2"), "n2");
    assert.strictEqual(resolveToNodeId(layout, "missing"), null);
  });

  it("mergePatchIntoMap classAdd is additive and idempotent (set semantics)", () => {
    let map = {};
    const patch = createPatch({ targetKey: "x", op: "classAdd", classes: ["w-full"] });
    map = mergePatchIntoMap(map, patch, "n1");
    assert.deepStrictEqual(map.n1, { classAdd: ["w-full"] });

    map = mergePatchIntoMap(map, patch, "n1");
    assert.deepStrictEqual(map.n1.classAdd, ["w-full"], "same classAdd twice should not duplicate");
  });

  it("mergePatchIntoMap classRemove merges", () => {
    let map = { n1: { classRemove: ["w-fit"] } };
    const patch = createPatch({ targetKey: "x", op: "classRemove", classes: ["self-start"] });
    map = mergePatchIntoMap(map, patch, "n1");
    assert.ok(map.n1.classRemove.includes("w-fit"));
    assert.ok(map.n1.classRemove.includes("self-start"));
  });

  it("mergePatchesMap merges two maps without duplicating classAdd", () => {
    const base = { n1: { classAdd: ["w-full"], classRemove: [], classReplace: {} } };
    const override = { n1: { classAdd: ["block"], classRemove: [], classReplace: {} } };
    const merged = mergePatchesMap(base, override);
    assert.deepStrictEqual(merged.n1.classAdd.sort(), ["block", "w-full"]);
  });

  it("applyPatchesToMap applies list of { patch, nodeId }", () => {
    const patches = [
      { patch: createPatch({ targetKey: "a", op: "classAdd", classes: ["w-full"] }), nodeId: "n1" },
      { patch: createPatch({ targetKey: "b", op: "classAdd", classes: ["block"] }), nodeId: "n1" },
    ];
    const map = applyPatchesToMap({}, patches);
    assert.ok(map.n1.classAdd.includes("w-full"));
    assert.ok(map.n1.classAdd.includes("block"));
  });
});
