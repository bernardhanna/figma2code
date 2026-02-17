import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { writePhase1Stage } from "../phase1Overlay.js";
import { STAGING_DIR } from "../runtimePaths.js";

test("phase1 raw JSON preserves node exportSettings metadata", () => {
  const slug = "_test_phase1_export_settings_meta";
  const dir = path.join(STAGING_DIR, "phase1", slug);
  try {
    const ast = {
      slug,
      type: "flexi_block",
      frame: { w: 800, h: 480 },
      meta: { schema: "raw-figma-ast", version: 1, exportedAt: new Date().toISOString() },
      tree: {
        id: "root",
        name: "Export Frame",
        type: "FRAME",
        w: 800,
        h: 480,
        bb: { x: 40, y: 80, w: 800, h: 480 },
        children: [
          {
            id: "logo-node",
            name: "Logo",
            type: "VECTOR",
            w: 120,
            h: 48,
            bb: { x: 72, y: 112, w: 120, h: 48 },
            exportSettings: [
              {
                format: "PNG",
                constraintType: "SCALE",
                constraintValue: 2,
                suffix: "@2x",
              },
              {
                format: "SVG",
                suffix: "",
              },
            ],
          },
        ],
      },
      slots: null,
    };

    const out = writePhase1Stage(slug, ast);
    const raw = JSON.parse(fs.readFileSync(out.rawPath, "utf8"));
    const node = raw?.tree?.children?.[0];
    assert.ok(Array.isArray(node?.exportSettings));
    assert.equal(node.exportSettings.length, 2);
    assert.deepEqual(node.exportSettings[0], {
      format: "PNG",
      constraintType: "SCALE",
      constraintValue: 2,
      suffix: "@2x",
    });
    assert.deepEqual(node.exportSettings[1], {
      format: "SVG",
      suffix: "",
    });
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
