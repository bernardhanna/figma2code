import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";

import {
  buildAlignedComparedPngs,
  isPythonVisualEnabled,
  pythonVisualServiceUrl,
} from "../pythonVisualClient.js";

test("pythonVisualServiceUrl trims trailing slash", () => {
  const prev = process.env.VISUAL_PY_URL;
  process.env.VISUAL_PY_URL = "http://127.0.0.1:8091/";
  assert.equal(pythonVisualServiceUrl(), "http://127.0.0.1:8091");
  process.env.VISUAL_PY_URL = prev;
});

test("isPythonVisualEnabled checks env flag", () => {
  const prev = process.env.VISUAL_PY_ENABLE;
  process.env.VISUAL_PY_ENABLE = "1";
  assert.equal(isPythonVisualEnabled(), true);
  process.env.VISUAL_PY_ENABLE = "0";
  assert.equal(isPythonVisualEnabled(), false);
  process.env.VISUAL_PY_ENABLE = prev;
});

test("buildAlignedComparedPngs creates aligned crops", () => {
  const fig = new PNG({ width: 10, height: 10 });
  const out = new PNG({ width: 10, height: 10 });
  const compared = buildAlignedComparedPngs({
    PNG,
    figmaPng: fig,
    renderPng: out,
    dx: 2,
    dy: -1,
  });
  assert.ok(compared);
  assert.equal(compared.compared.width, 8);
  assert.equal(compared.compared.height, 9);
});

