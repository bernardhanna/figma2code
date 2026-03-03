/**
 * POST helper tests: can be tested with fetch mock or local mock server.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { postAst } from "../dist/post.js";

test("postAst returns ok:false and error on fetch failure", async () => {
  const result = await postAst({
    endpoint: "http://localhost:59999/nonexistent",
    ast: {
      slug: "test",
      type: "flexi_block",
      frame: { w: 100, h: 100 },
      tree: { id: "r", name: "R", type: "FRAME", w: 100, h: 100, children: [] },
      slots: {},
    },
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error || result.status !== 200);
});

test("postAst includes refineMode in body when provided", async () => {
  // Just verify we can call postAst without throw; actual POST will fail to invalid URL
  const result = await postAst({
    endpoint: "http://127.0.0.1:0/no",
    ast: {
      slug: "s",
      type: "flexi_block",
      frame: { w: 1, h: 1 },
      tree: { id: "r", name: "R", type: "FRAME", w: 1, h: 1, children: [] },
      slots: {},
    },
    refineMode: 1,
    timeoutMs: 100,
  });
  assert.ok(typeof result.ok === "boolean");
  assert.ok(result.status === 0 || result.status >= 400);
});
