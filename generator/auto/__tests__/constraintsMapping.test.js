import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

function childHtmlFor(nodeId, html) {
  const re = new RegExp(`<[^>]*data-node-id="${nodeId}"[^>]*class="([^"]*)"[^>]*>`, "i");
  const m = String(html || "").match(re);
  return m ? m[1] : "";
}

test("non-auto child with LEFT_RIGHT constraint gets responsive stretch width", () => {
  const tree = {
    id: "root",
    name: "Root",
    children: [
      {
        id: "child-a",
        name: "Panel",
        constraints: { horizontal: "LEFT_RIGHT" },
        children: [],
      },
    ],
  };
  const html = renderNode(tree, null, true, {}, {});
  const classes = childHtmlFor("child-a", html);
  assert.ok(classes.includes("w-full"));
  assert.ok(classes.includes("max-w-full"));
});

test("non-auto child with CENTER constraint gets mx-auto anchoring", () => {
  const tree = {
    id: "root",
    name: "Root",
    children: [
      {
        id: "child-b",
        name: "Card",
        constraints: { horizontal: "CENTER" },
        children: [],
      },
    ],
  };
  const html = renderNode(tree, null, true, {}, {});
  const classes = childHtmlFor("child-b", html);
  assert.ok(classes.includes("mx-auto"));
});
