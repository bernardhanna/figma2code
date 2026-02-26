import test from "node:test";
import assert from "node:assert/strict";

import { autoLayoutify } from "../autoLayoutify/index.js";

function makeAst({ clipsContent }) {
  return {
    tree: {
      id: "root",
      key: "root",
      name: "Root",
      clipsContent: !!clipsContent,
      w: 1200,
      h: 600,
      children: [],
    },
    meta: {},
  };
}

test("section wrapper does not force overflow-hidden when root does not clip", () => {
  const html = autoLayoutify(makeAst({ clipsContent: false }), { wrap: true });
  assert.ok(!html.includes("overflow-hidden"));
});

test("section wrapper includes overflow-hidden only when root clips", () => {
  const html = autoLayoutify(makeAst({ clipsContent: true }), { wrap: true });
  assert.ok(html.includes("overflow-hidden"));
});

test("uses frame width for mixed multi-column child widths", () => {
  const ast = makeAst({ clipsContent: false });
  ast.tree.w = 1280;
  ast.tree.children = [
    { id: "a", key: "frame:left", tag: "div", w: 186, h: 100, children: [] },
    { id: "b", key: "frame:right", tag: "div", w: 766, h: 100, children: [] },
  ];
  const html = autoLayoutify(ast, { wrap: true });
  assert.ok(html.includes("max-w-[80rem]"));
});
