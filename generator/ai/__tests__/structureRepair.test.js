import test from "node:test";
import assert from "node:assert/strict";

import { applyStructureEdits } from "../structureRepair.js";

function sampleAst() {
  return {
    tree: {
      id: "root",
      type: "FRAME",
      children: [
        { id: "a", type: "FRAME", classes: ["flex"], children: [] },
        { id: "b", type: "FRAME", classes: ["grid"], children: [] },
        {
          id: "c",
          type: "FRAME",
          classes: ["flex-col"],
          children: [{ id: "c1", type: "FRAME", classes: [], children: [] }],
        },
      ],
    },
  };
}

test("applyStructureEdits rejects non-contiguous wrap childIds", () => {
  const ast = sampleAst();
  const script = {
    version: 1,
    bucket: "desktop",
    targetRootId: "root",
    ops: [
      {
        op: "wrap",
        parentId: "root",
        childIds: ["a", "c"],
        wrapper: { tag: "div", classAdd: ["w-full"] },
      },
    ],
  };
  assert.throws(() => applyStructureEdits(ast, script), /contiguous siblings/);
});

test("applyStructureEdits rejects reorder with invalid children set", () => {
  const ast = sampleAst();
  const script = {
    version: 1,
    bucket: "desktop",
    targetRootId: "root",
    ops: [
      {
        op: "reorder",
        parentId: "root",
        childIds: ["a", "b"], // missing c
      },
    ],
  };
  assert.throws(() => applyStructureEdits(ast, script), /exactly existing children/);
});

test("applyStructureEdits rejects cross-subtree references", () => {
  const ast = sampleAst();
  const script = {
    version: 1,
    bucket: "desktop",
    targetRootId: "c",
    ops: [
      {
        op: "move",
        nodeId: "a",
        newParentId: "c",
        position: { type: "append" },
      },
    ],
  };
  assert.throws(() => applyStructureEdits(ast, script), /outside target subtree/);
});
