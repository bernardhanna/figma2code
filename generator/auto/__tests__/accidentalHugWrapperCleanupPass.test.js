import test from "node:test";
import assert from "node:assert/strict";

import { accidentalHugWrapperCleanupPass } from "../accidentalHugWrapperCleanupPass.js";

test("collapses 3-level accidental wrappers with neutral styles to one layer", () => {
  const ast = {
    tree: {
      id: "root",
      type: "FRAME",
      x: 0,
      y: 0,
      w: 320,
      h: 120,
      children: [
        {
          id: "w1",
          key: "w1",
          type: "FRAME",
          x: 0,
          y: 0,
          w: 320,
          h: 120,
          children: [
            {
              id: "w2",
              key: "w2",
              type: "FRAME",
              x: 0,
              y: 0,
              w: 320,
              h: 120,
              children: [
                {
                  id: "leaf",
                  key: "leaf",
                  type: "FRAME",
                  x: 0,
                  y: 0,
                  w: 320,
                  h: 120,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  accidentalHugWrapperCleanupPass(ast);
  assert.equal(ast.tree.children.length, 1);
  assert.equal(ast.tree.children[0].id, "leaf");
  assert.equal(ast.meta?.accidentalHugCleanup?.collapsed, 2);
});

test("keeps wrapper with background fill", () => {
  const ast = {
    tree: {
      id: "root",
      type: "FRAME",
      x: 0,
      y: 0,
      w: 300,
      h: 100,
      children: [
        {
          id: "bg-wrapper",
          type: "FRAME",
          x: 0,
          y: 0,
          w: 300,
          h: 100,
          fills: [{ kind: "solid", r: 0.8, g: 0.8, b: 0.8, a: 1 }],
          children: [
            { id: "content", type: "FRAME", x: 0, y: 0, w: 300, h: 100, children: [] },
          ],
        },
      ],
    },
  };

  accidentalHugWrapperCleanupPass(ast);
  assert.equal(ast.tree.children.length, 1);
  assert.equal(ast.tree.children[0].id, "bg-wrapper");
});

test("keeps relative wrapper when descendant uses absolute positioning and parent is not relative", () => {
  const ast = {
    tree: {
      id: "root",
      type: "FRAME",
      x: 0,
      y: 0,
      w: 360,
      h: 180,
      children: [
        {
          id: "anchor-wrapper",
          type: "FRAME",
          x: 0,
          y: 0,
          w: 360,
          h: 180,
          tw: "relative",
          children: [
            {
              id: "card",
              type: "FRAME",
              x: 0,
              y: 0,
              w: 360,
              h: 180,
              children: [
                {
                  id: "badge",
                  type: "FRAME",
                  x: 300,
                  y: 8,
                  w: 52,
                  h: 24,
                  tw: "absolute top-2 right-2",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  accidentalHugWrapperCleanupPass(ast);
  assert.equal(ast.tree.children.length, 1);
  assert.equal(ast.tree.children[0].id, "anchor-wrapper");
});
