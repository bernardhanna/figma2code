import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";

import {
  classifyFailureModes,
  generateDeterministicCandidates,
  rankOffendersByPixels,
  shouldAcceptImprovement,
} from "../visualOptimizer.js";

test("candidate generator emits bounded patches for padding/gap container", () => {
  const layout = [
    {
      nodeId: "root",
      tag: "div",
      className: "flex px-[2rem] gap-[1rem] items-start",
      parentClassName: "",
      bbox: { x: 0, y: 0, w: 400, h: 200 },
    },
  ];
  const offenders = [
    {
      nodeId: "root",
      pixels: 800,
      ratio: 0.2,
      bbox: { x: 0, y: 0, w: 400, h: 200 },
    },
  ];
  const hotZones = [{ nodeId: "root", coveredPixels: 800 }];

  const out = generateDeterministicCandidates({
    bucket: "desktop",
    layout,
    offenders,
    hotZones,
    maxCandidates: 12,
  });

  assert.ok(Array.isArray(out) && out.length > 0);

  // At least one candidate should contain bounded ops for the target node.
  const hasBounded = out.some((cand) => {
    const ops = cand?.patchMap?.root;
    if (!ops) return false;

    return (
      (Array.isArray(ops.classAdd) && ops.classAdd.length > 0) ||
      (Array.isArray(ops.classRemove) && ops.classRemove.length > 0) ||
      (ops.classReplace && Object.keys(ops.classReplace).length > 0) ||
      (ops.style && Object.keys(ops.style).length > 0)
    );
  });
  assert.equal(hasBounded, true);

  // Ensure the generator is not emitting no-op patches (common failure mode).
  const hasNoOpPatch = out.some((cand) => {
    return Object.values(cand?.patchMap || {}).some((ops) => {
      const add = Array.isArray(ops.classAdd) ? ops.classAdd.length : 0;
      const rem = Array.isArray(ops.classRemove) ? ops.classRemove.length : 0;
      const rep = ops.classReplace ? Object.keys(ops.classReplace).length : 0;
      const sty = ops.style ? Object.keys(ops.style).length : 0;
      return add === 0 && rem === 0 && rep === 0 && sty === 0;
    });
  });
  assert.equal(hasNoOpPatch, false);
});

test("acceptance gating rejects zero/negative improvement and respects epsilon", () => {
  const epsilon = 0.0005;

  const zero = shouldAcceptImprovement({
    beforeDiff: 0.4,
    afterDiff: 0.4,
    epsilon,
  });
  assert.equal(zero.accept, false);

  const negative = shouldAcceptImprovement({
    beforeDiff: 0.4,
    afterDiff: 0.41,
    epsilon,
  });
  assert.equal(negative.accept, false);

  // Improvement smaller than epsilon => reject
  const tiny = shouldAcceptImprovement({
    beforeDiff: 0.4,
    afterDiff: 0.3997,
    epsilon,
  });
  assert.equal(tiny.accept, false);

  // Improvement larger than epsilon => accept
  const good = shouldAcceptImprovement({
    beforeDiff: 0.4,
    afterDiff: 0.399,
    epsilon,
  });
  assert.equal(good.accept, true);
});

test("offender ranking uses pixels and skips tiny bboxes", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "visual-opt-"));
  try {
    const diffPath = path.join(tmp, "diff.png");
    const outPath = path.join(tmp, "element-diff.json");
    const png = new PNG({ width: 32, height: 32 });

    // Small area (5x5 => 25): should be skipped by minBboxArea=200.
    for (let y = 1; y < 6; y += 1) {
      for (let x = 1; x < 6; x += 1) {
        const idx = (png.width * y + x) << 2;
        png.data[idx + 0] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }

    // Large area (16x16 => 256): should be kept.
    for (let y = 10; y < 26; y += 1) {
      for (let x = 10; x < 26; x += 1) {
        const idx = (png.width * y + x) << 2;
        png.data[idx + 0] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }

    fs.writeFileSync(diffPath, PNG.sync.write(png));

    const layout = [
      {
        nodeId: "tiny",
        tag: "div",
        className: "w-[2rem]",
        parentClassName: "",
        bbox: { x: 1, y: 1, w: 5, h: 5 },
      },
      {
        nodeId: "large",
        tag: "div",
        className: "w-[20rem]",
        parentClassName: "",
        bbox: { x: 10, y: 10, w: 16, h: 16 },
      },
    ];

    const offenders = rankOffendersByPixels({
      diffPath,
      outPath,
      layout,
      minBboxArea: 200,
      topOffenders: 10,
    });

    assert.equal(offenders.length, 1);
    assert.equal(offenders[0].nodeId, "large");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("offender ranking sorts by pixel count descending", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "visual-opt-sort-"));
  try {
    const diffPath = path.join(tmp, "diff.png");
    const outPath = path.join(tmp, "element-diff.json");
    const png = new PNG({ width: 64, height: 64 });

    // Node A: medium diff area (16x16 = 256)
    for (let y = 5; y < 21; y += 1) {
      for (let x = 5; x < 21; x += 1) {
        const idx = (png.width * y + x) << 2;
        png.data[idx + 0] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }

    // Node B: larger diff area (24x24 = 576)
    for (let y = 30; y < 54; y += 1) {
      for (let x = 30; x < 54; x += 1) {
        const idx = (png.width * y + x) << 2;
        png.data[idx + 0] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }

    fs.writeFileSync(diffPath, PNG.sync.write(png));

    const layout = [
      {
        nodeId: "medium",
        tag: "div",
        className: "w-[10rem]",
        parentClassName: "",
        bbox: { x: 5, y: 5, w: 16, h: 16 }, // 256px
      },
      {
        nodeId: "large",
        tag: "div",
        className: "w-[20rem]",
        parentClassName: "",
        bbox: { x: 30, y: 30, w: 24, h: 24 }, // 576px
      },
    ];

    const offenders = rankOffendersByPixels({
      diffPath,
      outPath,
      layout,
      minBboxArea: 200,
      topOffenders: 10,
    });

    assert.equal(offenders.length, 2);
    assert.equal(offenders[0].nodeId, "large");
    assert.equal(offenders[1].nodeId, "medium");
    assert.ok(offenders[0].pixels > offenders[1].pixels);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("failure classification labels structural and offset dominated modes", () => {
  const classified = classifyFailureModes({
    alignments: [{ dx: 8, dy: 0 }],
    textAABlockedCount: 1,
    constraintConflict: true,
    wrongLayoutModel: false,
    decorInFlow: false,
  });
  assert.equal(classified.offsetDominated, true);
  assert.equal(classified.textAADominated, true);
  assert.equal(classified.constraintConflict, true);
  assert.equal(classified.recommendedRoute, "structure-repair");
});
