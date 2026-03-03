/**
 * URL parsing tests: fileKey, node-id, hyphen/colon conversion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseFigmaDesignUrl, nodeIdHyphenToColon, requireNodeId } from "../dist/figma/url.js";

test("parseFigmaDesignUrl extracts fileKey and node-id", () => {
  const url = "https://www.figma.com/design/AbC123XyZ/MyFile?node-id=42-15";
  const parts = parseFigmaDesignUrl(url);
  assert.ok(parts);
  assert.equal(parts.fileKey, "AbC123XyZ");
  assert.equal(parts.nodeIdHyphen, "42-15");
  assert.equal(parts.nodeIdColon, "42:15");
});

test("parseFigmaDesignUrl converts node-id to colon format", () => {
  const url = "https://figma.com/design/f1l3k3y/Page?node-id=1-2";
  const parts = parseFigmaDesignUrl(url);
  assert.ok(parts);
  assert.equal(parts.nodeIdHyphen, "1-2");
  assert.equal(parts.nodeIdColon, "1:2");
});

test("parseFigmaDesignUrl returns null when node-id is missing", () => {
  const url = "https://figma.com/design/abc/File";
  const parts = parseFigmaDesignUrl(url);
  assert.equal(parts, null);
});

test("parseFigmaDesignUrl returns null for invalid URL", () => {
  assert.equal(parseFigmaDesignUrl("not-a-url"), null);
  assert.equal(parseFigmaDesignUrl(""), null);
});

test("nodeIdHyphenToColon converts hyphens to colons", () => {
  assert.equal(nodeIdHyphenToColon("1-2"), "1:2");
  assert.equal(nodeIdHyphenToColon("42-15"), "42:15");
  assert.equal(nodeIdHyphenToColon("1-2-3"), "1:2:3");
});

test("requireNodeId throws when node-id missing", () => {
  assert.throws(
    () => requireNodeId("https://figma.com/design/abc/File"),
    /node-id|Invalid/
  );
});

test("requireNodeId returns parts when URL valid", () => {
  const parts = requireNodeId("https://figma.com/design/xyz/File?node-id=99-1");
  assert.equal(parts.fileKey, "xyz");
  assert.equal(parts.nodeIdHyphen, "99-1");
  assert.equal(parts.nodeIdColon, "99:1");
});
