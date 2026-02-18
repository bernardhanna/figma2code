import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { writePhase1Stage } from "../phase1Overlay.js";
import { STAGING_DIR } from "../runtimePaths.js";

test("phase1 raw JSON preserves auto-layout wrap metadata", () => {
  const slug = "_test_phase1_wrap_meta";
  const dir = path.join(STAGING_DIR, "phase1", slug);
  try {
    const ast = {
      slug,
      type: "flexi_block",
      frame: { w: 1200, h: 640 },
      meta: { schema: "raw-figma-ast", version: 1, exportedAt: new Date().toISOString() },
      tree: {
        id: "root",
        name: "Wrapped Frame",
        type: "FRAME",
        w: 1200,
        h: 640,
        auto: {
          layout: "HORIZONTAL",
          itemSpacing: 24,
          padT: 24,
          padR: 24,
          padB: 24,
          padL: 24,
          primaryAlign: "MIN",
          counterAlign: "MIN",
          primarySizing: "FIXED",
          counterSizing: "FIXED",
          layoutWrap: "WRAP",
          wrap: true,
          counterAxisAlignContent: "AUTO",
          counterAxisSpacing: 16,
        },
        children: [],
      },
      slots: null,
    };

    const out = writePhase1Stage(slug, ast);
    const raw = JSON.parse(fs.readFileSync(out.rawPath, "utf8"));
    assert.equal(raw?.tree?.auto?.layoutWrap, "WRAP");
    assert.equal(raw?.tree?.auto?.wrap, true);
    assert.equal(raw?.tree?.auto?.counterAxisAlignContent, "AUTO");
    assert.equal(raw?.tree?.auto?.counterAxisSpacing, 16);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
