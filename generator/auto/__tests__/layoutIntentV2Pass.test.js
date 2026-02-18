import test from "node:test";
import assert from "node:assert/strict";

import { layoutIntentV2Pass } from "../layoutIntentV2Pass.js";
import { flexResponsiveClasses, shouldUseGrid } from "../autoLayoutify/layoutGridFlex.js";

function makeNode(id, x, y, w, h) {
  return { id, x, y, w, h, children: [] };
}

test("layoutIntentV2 infers horizontal axis for side-by-side children", () => {
  const ast = {
    tree: {
      id: "root",
      children: [
        makeNode("a", 0, 0, 120, 80),
        makeNode("b", 140, 4, 118, 82),
        makeNode("c", 280, 2, 122, 78),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  assert.equal(ast.tree.__layoutHints?.axis, "horizontal");
  assert.equal(Boolean(ast.tree.__layoutHints?.collectionLike), true);
});

test("layoutIntentV2 infers vertical axis for stacked children", () => {
  const ast = {
    tree: {
      id: "root",
      children: [
        makeNode("a", 0, 0, 300, 80),
        makeNode("b", 2, 110, 300, 80),
        makeNode("c", 0, 220, 300, 80),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  assert.equal(ast.tree.__layoutHints?.axis, "vertical");
});

test("grid selection can use collection hint when auto layout is absent", () => {
  const node = {
    id: "group",
    name: "cards",
    auto: null,
    __layoutHints: { axis: "horizontal", collectionLike: true, colsHint: 3 },
    children: [
      makeNode("a", 0, 0, 120, 120),
      makeNode("b", 140, 0, 120, 120),
      makeNode("c", 280, 0, 120, 120),
    ],
  };
  assert.equal(shouldUseGrid(node, {}), true);
});

test("layoutIntentV2 detects y-band rows and infers row/column gaps", () => {
  const ast = {
    tree: {
      id: "gridish",
      children: [
        makeNode("a", 0, 0, 120, 100),
        makeNode("b", 150, 2, 120, 100),
        makeNode("c", 0, 150, 120, 100),
        makeNode("d", 150, 152, 120, 100),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  const hints = ast.tree.__layoutHints || {};
  assert.equal(hints.collectionLike, true);
  assert.equal(hints.rowCount, 2);
  assert.equal(hints.colCount, 2);
  assert.equal(Boolean(hints.alignedColumns), true);
  assert.equal(Boolean(hints.repeatedWidths), true);
  assert.equal(Boolean(hints.gridCandidate), true);
  assert.ok(Number(hints.rowGapPx) >= 40);
  assert.ok(Number(hints.colGapPx) >= 20);
});

test("layoutIntentV2 flags low-confidence ambiguous non-auto groups", () => {
  const ast = {
    tree: {
      id: "ambiguous",
      children: [
        makeNode("a", 0, 0, 120, 100),
        makeNode("b", 92, 68, 180, 84),
        makeNode("c", 188, 18, 96, 150),
        makeNode("d", 36, 162, 142, 92),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  const hints = ast.tree.__layoutHints || {};
  assert.equal(Boolean(hints.lowConfidence), true);
  assert.equal(Boolean(hints.fallbackRecommended), true);
});

test("gridCandidate drives grid inference for repeated card gallery", () => {
  const node = {
    id: "gallery",
    name: "Card gallery",
    auto: null,
    __layoutHints: {
      axis: "horizontal",
      collectionLike: true,
      colsHint: 3,
      rowCount: 2,
      colCount: 3,
      alignedColumns: true,
      repeatedWidths: true,
      regularity: 0.9,
      gridCandidate: true,
    },
    children: [
      makeNode("a", 0, 0, 260, 180),
      makeNode("b", 280, 0, 258, 180),
      makeNode("c", 560, 0, 262, 180),
      makeNode("d", 0, 210, 260, 180),
      makeNode("e", 280, 210, 258, 180),
      makeNode("f", 560, 210, 262, 180),
    ],
  };
  assert.equal(shouldUseGrid(node, {}), true);
});

test("explicit auto-layout never upgrades to grid heuristics", () => {
  const node = {
    id: "auto-row",
    name: "Auto row",
    auto: { layout: "HORIZONTAL" },
    __layoutHints: { axis: "horizontal", collectionLike: true, colsHint: 3 },
    children: [
      makeNode("a", 0, 0, 120, 120),
      makeNode("b", 140, 0, 120, 120),
      makeNode("c", 280, 0, 120, 120),
    ],
  };
  assert.equal(shouldUseGrid(node, {}), false);
});

test("flex wrap mapping follows explicit auto wrap signal", () => {
  const withWrap = flexResponsiveClasses(
    { layout: "HORIZONTAL", layoutWrap: "WRAP", primaryAlign: "MIN", counterAlign: "MIN" },
    [makeNode("a", 0, 0, 100, 40), makeNode("b", 110, 0, 100, 40), makeNode("c", 220, 0, 100, 40)]
  );
  const noWrap = flexResponsiveClasses(
    { layout: "HORIZONTAL", layoutWrap: "NO_WRAP", primaryAlign: "MIN", counterAlign: "MIN" },
    [makeNode("a", 0, 0, 100, 40), makeNode("b", 110, 0, 100, 40), makeNode("c", 220, 0, 100, 40)]
  );
  assert.ok(withWrap.includes("md:flex-wrap"));
  assert.ok(!noWrap.includes("md:flex-wrap"));
});

