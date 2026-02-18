import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { writePhase1Stage } from "../phase1Overlay.js";
import { STAGING_DIR } from "../runtimePaths.js";

test("phase1 raw JSON preserves mask metadata and mask relationships", () => {
  const slug = "_test_phase1_mask_meta";
  const dir = path.join(STAGING_DIR, "phase1", slug);
  try {
    const ast = {
      slug,
      type: "flexi_block",
      frame: { w: 900, h: 500 },
      meta: { schema: "raw-figma-ast", version: 1, exportedAt: new Date().toISOString() },
      tree: {
        id: "root",
        name: "Mask Frame",
        type: "FRAME",
        w: 900,
        h: 500,
        bb: { x: 50, y: 120, w: 900, h: 500 },
        children: [
          {
            id: "mask-source",
            name: "Mask shape",
            type: "VECTOR",
            isMask: true,
            mask: {
              maskType: "ALPHA",
              maskMode: "MASK",
              maskKind: "vector",
              preferredRender: "svg-mask",
              appliesTo: "siblings",
              targetIds: ["masked-content"],
            },
            bb: { x: 100, y: 160, w: 300, h: 220 },
          },
          {
            id: "masked-content",
            name: "Content",
            type: "RECTANGLE",
            maskedBy: "mask-source",
            bb: { x: 100, y: 160, w: 300, h: 220 },
          },
        ],
      },
      slots: null,
    };

    const out = writePhase1Stage(slug, ast);
    const raw = JSON.parse(fs.readFileSync(out.rawPath, "utf8"));
    const maskNode = raw?.tree?.children?.[0];
    const contentNode = raw?.tree?.children?.[1];

    assert.equal(maskNode?.isMask, true);
    assert.equal(maskNode?.mask?.maskKind, "vector");
    assert.equal(maskNode?.mask?.preferredRender, "svg-mask");
    assert.equal(maskNode?.mask?.appliesTo, "siblings");
    assert.deepEqual(maskNode?.mask?.targetIds, ["masked-content"]);
    assert.equal(contentNode?.maskedBy, "mask-source");
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
