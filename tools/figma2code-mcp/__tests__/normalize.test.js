/**
 * Normalizer tests: McpBundle → AST with required keys, tree.children array.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMcpToPluginAst } from "../dist/normalize/mcpToPluginAst.js";

test("normalizeMcpToPluginAst outputs AST with required keys", () => {
  const mcp = {
    metadata: `<node id="root" name="Frame" type="FRAME" x="0" y="0" width="400" height="300" />`,
  };
  const ast = normalizeMcpToPluginAst(mcp, { slug: "test-section" });
  assert.ok(ast.slug);
  assert.ok(ast.type === "flexi_block" || ast.type === "navbar" || ast.type === "footer");
  assert.ok(ast.frame && typeof ast.frame.w === "number" && typeof ast.frame.h === "number");
  assert.ok(ast.tree);
  assert.ok(typeof ast.slots === "object");
  assert.equal(ast.slug, "test-section");
  assert.ok(ast.tree.id);
  assert.ok(ast.tree.name);
  assert.ok(ast.tree.type);
  assert.equal(typeof ast.tree.w, "number");
  assert.equal(typeof ast.tree.h, "number");
});

test("normalizeMcpToPluginAst ensures tree.children is always an array", () => {
  const mcp = { designContext: "some non-JSON text" };
  const ast = normalizeMcpToPluginAst(mcp, { slug: "empty" });
  assert.ok(Array.isArray(ast.tree.children));
  assert.equal(ast.tree.children.length, 0);
});

test("normalizeMcpToPluginAst parses metadata XML into tree", () => {
  const mcp = {
    metadata: `<doc><node id="r" name="Root" type="FRAME" x="10" y="20" width="100" height="80" /></doc>`,
  };
  const ast = normalizeMcpToPluginAst(mcp, { slug: "from-meta" });
  assert.ok(ast.tree.id);
  assert.equal(ast.tree.w, 100);
  assert.equal(ast.tree.h, 80);
  assert.ok(Array.isArray(ast.tree.children));
});

test("normalizeMcpToPluginAst accepts type navbar", () => {
  const mcp = {};
  const ast = normalizeMcpToPluginAst(mcp, { slug: "nav", type: "navbar" });
  assert.equal(ast.type, "navbar");
});

test("normalizeMcpToPluginAst puts screenshot in meta", () => {
  const mcp = { screenshot: "data:image/png;base64,abc" };
  const ast = normalizeMcpToPluginAst(mcp, { slug: "s1" });
  assert.ok(ast.meta?.overlay);
  assert.equal(ast.meta.overlay.src, "data:image/png;base64,abc");
});
