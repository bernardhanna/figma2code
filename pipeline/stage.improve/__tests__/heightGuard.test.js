const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHtmlNodes } = require("../../stage.codeit/contracts/utils/html");
const {
  isProtectedMediaNode,
  canProveClipping,
  isHeightTokenGuarded,
  guardedHeightPatchFilter,
} = require("../utilities/heightGuard");

function buildChildrenMap(nodes) {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent === null || parent === undefined) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
}

test("isProtectedMediaNode: data-key containing hero is protected", () => {
  const html = '<div data-key="frame:hero#1" class="h-[27.5rem] overflow-hidden rounded-lg">x</div>';
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const node = nodes[0];
  const ctx = { nodes, childrenMap, nodeIndex: 0 };
  assert.equal(isProtectedMediaNode(node, ctx), true);
});

test("isProtectedMediaNode: data-h-intent fixed is protected", () => {
  const html = '<div data-h-intent="fixed" class="h-[32rem]">x</div>';
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const node = nodes[0];
  const ctx = { nodes, childrenMap, nodeIndex: 0 };
  assert.equal(isProtectedMediaNode(node, ctx), true);
});

test("isProtectedMediaNode: plain wrapper is not protected", () => {
  const html = '<div data-key="frame:card" class="h-[8.25rem]">x</div>';
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const node = nodes[0];
  const ctx = { nodes, childrenMap, nodeIndex: 0 };
  assert.equal(isProtectedMediaNode(node, ctx), false);
});

test("canProveClipping: without measurements returns false", () => {
  const node = { tag: "div", attrs: {} };
  assert.equal(canProveClipping(node, {}), false);
});

test("canProveClipping: with scrollHeight > clientHeight and overflow + text-like returns true", () => {
  const node = { tag: "div", attrs: {} };
  const measurements = {
    overflowHidden: true,
    hasTextLikeContent: true,
    scrollHeight: 100,
    clientHeight: 50,
  };
  assert.equal(canProveClipping(node, measurements), true);
});

test("isHeightTokenGuarded: h-[27.5rem] is guarded", () => {
  assert.equal(isHeightTokenGuarded("h-[27.5rem]"), true);
  assert.equal(isHeightTokenGuarded("lg:h-[27.5rem]"), true);
});

test("guardedHeightPatchFilter: patch removing h-[27.5rem] on protected hero is rejected", () => {
  const html = '<div data-key="frame:hero#1" class="h-[27.5rem] overflow-hidden rounded-lg">x</div>';
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const nodeMap = new Map();
  nodeMap.set("frame:hero#1", {
    node: nodes[0],
    context: { nodes, childrenMap, nodeIndex: 0 },
  });

  const planEntries = [
    {
      patch: {
        nodeId: "frame:hero#1",
        selector: '[data-key="frame:hero#1"]',
        ops: { classRemove: ["h-[27.5rem]"], classAdd: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
      },
      ledgerEntries: [],
    },
  ];

  const { accepted, rejectedWithReasons } = guardedHeightPatchFilter(planEntries, {
    nodeMap,
    isProtected: isProtectedMediaNode,
    canProveClipping: () => false,
    getMeasurements: () => ({}),
  });

  assert.equal(accepted.length, 0);
  assert.equal(rejectedWithReasons.length, 1);
  assert.equal(rejectedWithReasons[0].reason, "blocked: protected media/hero height");
  assert.equal(rejectedWithReasons[0].nodeId, "frame:hero#1");
});

test("guardedHeightPatchFilter: patch removing h-[8.25rem] without proof is rejected with clipping not proven", () => {
  const html = '<div data-key="frame:card" class="h-[8.25rem]">x</div>';
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const nodeMap = new Map();
  nodeMap.set("frame:card", {
    node: nodes[0],
    context: { nodes, childrenMap, nodeIndex: 0 },
  });

  const planEntries = [
    {
      patch: {
        nodeId: "frame:card",
        selector: '[data-key="frame:card"]',
        ops: { classRemove: ["h-[8.25rem]"], classAdd: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
      },
      ledgerEntries: [],
    },
  ];

  const { accepted, rejectedWithReasons } = guardedHeightPatchFilter(planEntries, {
    nodeMap,
    isProtected: isProtectedMediaNode,
    canProveClipping: () => false,
    getMeasurements: () => ({}),
  });

  assert.equal(accepted.length, 0);
  assert.equal(rejectedWithReasons.length, 1);
  assert.equal(rejectedWithReasons[0].reason, "clipping not proven");
});

test("guardedHeightPatchFilter: patch removing height with proven clipping is accepted", () => {
  const html = '<div data-key="frame:card" class="h-[8.25rem] overflow-hidden">x</div>';
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const nodeMap = new Map();
  nodeMap.set("frame:card", {
    node: nodes[0],
    context: { nodes, childrenMap, nodeIndex: 0 },
  });

  const planEntries = [
    {
      patch: {
        nodeId: "frame:card",
        selector: '[data-key="frame:card"]',
        ops: { classRemove: ["h-[8.25rem]"], classAdd: [], classReplace: {}, attrAdd: {}, attrRemove: [] },
      },
      ledgerEntries: [],
    },
  ];

  const { accepted, rejectedWithReasons } = guardedHeightPatchFilter(planEntries, {
    nodeMap,
    isProtected: isProtectedMediaNode,
    canProveClipping: () => true,
    getMeasurements: () => ({ overflowHidden: true, hasTextLikeContent: true, scrollHeight: 100, clientHeight: 50 }),
  });

  assert.equal(accepted.length, 1);
  assert.equal(rejectedWithReasons.length, 0);
});

test("guardedHeightPatchFilter: patch without height removal is accepted", () => {
  const planEntries = [
    {
      patch: {
        nodeId: "btn-1",
        selector: '[data-key="btn-1"]',
        ops: { classRemove: [], classAdd: ["aria-label"], classReplace: {}, attrAdd: { "aria-label": "Submit" }, attrRemove: [] },
      },
      ledgerEntries: [],
    },
  ];

  const { accepted, rejectedWithReasons } = guardedHeightPatchFilter(planEntries, {
    nodeMap: new Map(),
    isProtected: () => false,
    canProveClipping: () => false,
    getMeasurements: () => ({}),
  });

  assert.equal(accepted.length, 1);
  assert.equal(rejectedWithReasons.length, 0);
});
