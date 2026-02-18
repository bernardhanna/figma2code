import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  validateAndNormalizePatchMap,
  mergePatchMaps,
  patchesFilePath,
  writePatchMap,
  readPatchMap,
} from "../refineByDiff.js";
import { resolvePatchUrls } from "../../templates/preview/preview.patches.js";

test("preview patch URL resolution prefers bucket-specific with generic fallback", () => {
  const urls = resolvePatchUrls("hero_v3", "desktop");
  assert.equal(urls.bucketSpecific, "/fixtures.out/hero_v3/patches.desktop.json");
  assert.equal(urls.generic, "/fixtures.out/hero_v3/patches.json");
});

test("validation rejects unsafe payload and keeps safe patch tokens", () => {
  const payload = {
    "n1": {
      classAdd: ["w-full", "bad token"],
      classRemove: ["md:self-start"],
      classReplace: { "md:items-start": "md:items-center", "": "md:justify-center" },
      style: { position: "fixed", transform: "translateX(1px)" },
    },
  };
  const out = validateAndNormalizePatchMap(payload);
  assert.ok(out.rejected.length >= 1);
  assert.ok(out.accepted.n1);
  assert.deepEqual(out.accepted.n1.classRemove, ["md:self-start"]);
  assert.equal(out.accepted.n1.classReplace["md:items-start"], "md:items-center");
  assert.equal(out.accepted.n1.style.transform, "translateX(1px)");
  assert.equal(out.accepted.n1.style.position, undefined);
});

test("bucket patch file write/read and merge works", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "refine-test-"));
  try {
    const genericPath = patchesFilePath(tmp, "all");
    const bucketPath = patchesFilePath(tmp, "tablet");

    writePatchMap(genericPath, {
      n1: { classAdd: ["w-full"], classReplace: { "md:items-start": "md:items-center" } },
    });
    writePatchMap(bucketPath, {
      n1: { classReplace: { "md:items-center": "md:items-end" } },
      n2: { classRemove: ["self-start"] },
    });

    const merged = mergePatchMaps(readPatchMap(genericPath), readPatchMap(bucketPath));
    assert.equal(merged.n1.classReplace["md:items-start"], "md:items-center");
    assert.equal(merged.n1.classReplace["md:items-center"], "md:items-end");
    assert.deepEqual(merged.n2.classRemove, ["self-start"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
