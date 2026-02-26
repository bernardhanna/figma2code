import test from "node:test";
import assert from "node:assert/strict";

import { responsiveBreakpointInferencePass } from "../responsiveBreakpointInferencePass.js";

function makeNode(id, x, y, w, h, extra = {}) {
  return { id, x, y, w, h, children: [], ...extra };
}

test("4-col grid desktop infers base 1, md 2, lg 4", () => {
  const ast = {
    tree: {
      id: "grid-root",
      __layoutHints: { colCount: 4, colsHint: 4, gridCandidate: true },
      children: [
        makeNode("a", 0, 0, 200, 120),
        makeNode("b", 220, 0, 200, 120),
        makeNode("c", 440, 0, 200, 120),
        makeNode("d", 660, 0, 200, 120),
      ],
    },
  };
  responsiveBreakpointInferencePass(ast);
  assert.deepEqual(ast.tree.__responsivePlan?.layout?.gridCols, {
    base: 1,
    md: 2,
    lg: 4,
    source: "desktop-grid>=3",
  });
});

test("2-col desktop section infers stacked base and md two-col widths", () => {
  const ast = {
    tree: {
      id: "section",
      x: 0,
      y: 0,
      w: 1200,
      h: 500,
      __layoutHints: { axis: "horizontal" },
      children: [
        makeNode("left", 0, 0, 590, 400),
        makeNode("right", 610, 0, 590, 400),
      ],
    },
  };
  responsiveBreakpointInferencePass(ast);
  assert.deepEqual(ast.tree.__responsivePlan?.layout?.flexDirection, {
    base: "col",
    md: "row",
    source: "two-col-half-split",
  });
  assert.deepEqual(ast.tree.children[0].__responsivePlan?.width, {
    base: "full",
    md: "1/2",
    source: "two-col-half-split",
  });
  assert.deepEqual(ast.tree.children[1].__responsivePlan?.width, {
    base: "full",
    md: "1/2",
    source: "two-col-half-split",
  });
});

test("large side padding infers mobile normalization with lg restore", () => {
  const ast = {
    tree: {
      id: "padded",
      auto: { padL: 96, padR: 72 },
      children: [makeNode("c", 0, 0, 100, 100)],
    },
  };
  responsiveBreakpointInferencePass(ast);
  assert.deepEqual(ast.tree.__responsivePlan?.spacing?.paddingX, {
    basePx: 20,
    lgLeftPx: 96,
    lgRightPx: 72,
    source: "large-side-padding",
  });
});
