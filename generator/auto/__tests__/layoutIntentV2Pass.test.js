import test from "node:test";
import assert from "node:assert/strict";

import { layoutIntentV2Pass } from "../layoutIntentV2Pass.js";
import { flexResponsiveClasses, gridColsResponsive, shouldUseGrid } from "../autoLayoutify/layoutGridFlex.js";

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
  assert.equal(ast.tree.__layoutModel?.layoutType, "grid");
  assert.equal(ast.tree.__layoutPriors?.figma?.layout, "NONE");
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
  assert.equal(ast.tree.__layoutModel?.layoutType, "col");
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
  assert.equal(hints.layoutType, "grid");
  assert.equal(hints.rowCount, 2);
  assert.equal(hints.colCount, 2);
  assert.equal(Boolean(hints.alignedColumns), true);
  assert.equal(Boolean(hints.repeatedWidths), true);
  assert.equal(Boolean(hints.gridCandidate), true);
  assert.equal(Number(hints.metadata?.cols), 2);
  assert.ok(Number(hints.rowGapPx) >= 40);
  assert.ok(Number(hints.colGapPx) >= 20);
  assert.ok(Number(hints.metadata?.gapX) >= 20);
  assert.ok(Number(hints.metadata?.gapY) >= 40);
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

test("3x2 geometry infers deterministic grid cols and stable gaps", () => {
  const ast = {
    tree: {
      id: "grid-3x2",
      children: [
        makeNode("a", 0, 0, 120, 90),
        makeNode("b", 160, 1, 120, 90),
        makeNode("c", 320, 0, 120, 90),
        makeNode("d", 0, 130, 120, 90),
        makeNode("e", 160, 131, 120, 90),
        makeNode("f", 320, 130, 120, 90),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  const hints = ast.tree.__layoutHints || {};
  assert.equal(hints.layoutType, "grid");
  assert.equal(Boolean(hints.gridCandidate), true);
  assert.equal(Number(hints.metadata?.cols), 3);
  assert.ok(Number(hints.metadata?.gapX) >= 30);
  assert.ok(Number(hints.metadata?.gapY) >= 30);
});

test("tags cloud with variable widths does not convert to grid", () => {
  const ast = {
    tree: {
      id: "tags-cloud",
      children: [
        makeNode("a", 0, 0, 72, 36),
        makeNode("b", 84, 1, 164, 36),
        makeNode("c", 260, 0, 96, 36),
        makeNode("d", 0, 54, 188, 36),
        makeNode("e", 200, 53, 82, 36),
        makeNode("f", 294, 54, 142, 36),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  const hints = ast.tree.__layoutHints || {};
  assert.notEqual(hints.layoutType, "grid");
  assert.equal(Boolean(hints.gridCandidate), false);
  assert.equal(Boolean(shouldUseGrid(ast.tree, {})), false);
});

test("two-column list stays non-grid without strong signal", () => {
  const ast = {
    tree: {
      id: "two-col-list",
      children: [
        makeNode("a", 0, 0, 220, 28),
        makeNode("b", 260, 0, 120, 28),
        makeNode("c", 0, 46, 220, 28),
        makeNode("d", 260, 46, 124, 28),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  const hints = ast.tree.__layoutHints || {};
  assert.notEqual(hints.layoutType, "grid");
  assert.equal(Boolean(shouldUseGrid(ast.tree, {})), false);
});

test("Figma Layout guide Grid 10px sets layoutGuideGrid and layoutGuideGapPx", () => {
  const ast = {
    tree: {
      id: "root",
      name: "Frame",
      layoutGuide: { pattern: "GRID", sectionSize: 10 },
      children: [
        makeNode("a", 0, 0, 100, 50),
        makeNode("b", 110, 0, 100, 50),
      ],
    },
  };
  layoutIntentV2Pass(ast);
  const hints = ast.tree.__layoutHints || {};
  assert.equal(Boolean(hints.layoutGuideGrid), true);
  assert.equal(hints.layoutGuideGapPx, 10);
});

test("layoutGuideGrid drives grid when frame has Layout guide Grid", () => {
  const node = {
    id: "root",
    name: "Section",
    auto: {},
    __layoutHints: { axis: "horizontal", layoutGuideGrid: true, layoutGuideGapPx: 10 },
    children: [
      makeNode("a", 0, 0, 200, 80),
      makeNode("b", 210, 0, 200, 80),
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

test("grid responsive classes can be driven by inferred breakpoint plan", () => {
  const cls = gridColsResponsive({ base: 1, md: 2, lg: 4 });
  assert.match(cls, /\bgrid-cols-1\b/);
  assert.match(cls, /\bmd:grid-cols-2\b/);
  assert.match(cls, /\blg:grid-cols-4\b/);
});

test("flex responsive classes can use inferred two-column stack plan", () => {
  const cls = flexResponsiveClasses(
    { layout: "HORIZONTAL", primaryAlign: "MIN", counterAlign: "MIN" },
    [makeNode("a", 0, 0, 100, 40), makeNode("b", 110, 0, 100, 40)],
    { node: { __responsivePlan: { layout: { flexDirection: { base: "col", md: "row" } } } } }
  );
  assert.match(cls, /\bflex-col\b/);
  assert.match(cls, /\bmd:flex-row\b/);
});

