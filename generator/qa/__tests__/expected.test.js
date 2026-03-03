// generator/qa/__tests__/expected.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { expectedRectsFromAst } from "../expected.js";

describe("expectedRectsFromAst", () => {
  it("extracts rects from tree with bb", () => {
    const ast = {
      tree: {
        id: "root",
        key: "frame:root#1",
        bb: { x: 0, y: 0, w: 400, h: 300 },
        children: [
          {
            id: "btn",
            key: "instance:button#1",
            bb: { x: 20, y: 20, w: 360, h: 44 },
            children: [],
          },
        ],
      },
    };
    const { rects, parentRects } = expectedRectsFromAst(ast);
    assert.strictEqual(rects["frame:root#1"].w, 400);
    assert.strictEqual(rects["instance:button#1"].w, 360);
    assert.strictEqual(parentRects["instance:button#1"].w, 400);
  });

  it("uses node.id when key is missing", () => {
    const ast = {
      tree: {
        id: "onlyId",
        w: 100,
        h: 50,
        x: 0,
        y: 0,
        children: [],
      },
    };
    const { rects } = expectedRectsFromAst(ast);
    assert.deepStrictEqual(rects["onlyId"], { x: 0, y: 0, w: 100, h: 50 });
  });

  it("stores rects by both node.key and node.id for layout lookup", () => {
    const ast = {
      tree: {
        id: "36:1220",
        key: "instance:button#1",
        bb: { x: 10, y: 10, w: 200, h: 44 },
        children: [],
      },
    };
    const { rects, parentRects } = expectedRectsFromAst(ast);
    assert.strictEqual(rects["instance:button#1"].w, 200);
    assert.strictEqual(rects["36:1220"].w, 200);
  });
});
