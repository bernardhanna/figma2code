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
