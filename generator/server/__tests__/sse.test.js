import test from "node:test";
import assert from "node:assert/strict";

import { buildSseEvent } from "../sse.js";

test("buildSseEvent emits event/data on separate lines", () => {
  const payload = { iter: 2, bucket: "desktop" };
  const out = buildSseEvent("iter", payload);
  const lines = String(out).split("\n");
  assert.equal(lines[0], "event: iter");
  assert.equal(lines[1], `data: ${JSON.stringify(payload)}`);
});

test("buildSseEvent payload ends with blank-line terminator", () => {
  const out = buildSseEvent("done", { ok: true });
  assert.ok(out.endsWith("\n\n"));
});
