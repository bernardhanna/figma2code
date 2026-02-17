import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { writePhase1Stage } from "../phase1Overlay.js";
import { STAGING_DIR } from "../runtimePaths.js";

test("phase1 raw JSON preserves constraints and parent-relative coordinates", () => {
  const slug = "_test_phase1_constraints_rel";
  const dir = path.join(STAGING_DIR, "phase1", slug);
  try {
    const ast = {
      slug,
      type: "flexi_block",
      frame: { w: 1000, h: 600 },
      meta: { schema: "raw-figma-ast", version: 1, exportedAt: new Date().toISOString() },
      tree: {
        id: "root",
        name: "Frame",
        type: "FRAME",
        w: 1000,
        h: 600,
        bb: { x: 100, y: 200, w: 1000, h: 600 },
        children: [
          {
            id: "child-a",
            name: "Child A",
            type: "RECTANGLE",
            w: 200,
            h: 120,
            bb: { x: 140, y: 250, w: 200, h: 120 },
            relX: 40,
            relY: 50,
            constraints: { horizontal: "LEFT_RIGHT", vertical: "TOP" },
          },
          {
            id: "child-b",
            name: "Child B",
            type: "TEXT",
            w: 220,
            h: 48,
            bb: { x: 760, y: 680, w: 220, h: 48 },
            relX: 660,
            relY: 480,
            constraints: { horizontal: "RIGHT", vertical: "BOTTOM" },
          },
        ],
      },
      slots: null,
    };

    const out = writePhase1Stage(slug, ast);
    const raw = JSON.parse(fs.readFileSync(out.rawPath, "utf8"));
    const child = raw?.tree?.children?.[0];
    assert.equal(child?.relX, 40);
    assert.equal(child?.relY, 50);
    assert.equal(child?.constraints?.horizontal, "LEFT_RIGHT");
    assert.equal(child?.constraints?.vertical, "TOP");
    const childB = raw?.tree?.children?.[1];
    assert.equal(childB?.constraints?.horizontal, "RIGHT");
    assert.equal(childB?.constraints?.vertical, "BOTTOM");
    // Keep absolute BB untouched.
    assert.deepEqual(child?.bb, { x: 140, y: 250, w: 200, h: 120 });
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
