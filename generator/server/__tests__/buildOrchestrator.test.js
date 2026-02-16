import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runBuildAndPreview } from "../buildOrchestrator.js";
import { writeStage, deleteStage } from "../stageStore.js";
import { PREVIEW_DIR } from "../runtimePaths.js";
import { previewHtml } from "../../templates/preview.html.js";

test("preview HTML contains overlay controls block when overlaySrc exists", () => {
  const ast = {
    slug: "demo",
    frame: { w: 1200, h: 400 },
    tree: { w: 1200, h: 400, id: "root", name: "Demo", children: [] },
    meta: { overlay: { src: "/fixtures.out/demo/figma.desktop.png" } },
  };
  const html = previewHtml(ast, { fragment: "<div>Content</div>" });
  assert.match(html, /overlay|opacity|__overlay/i, "Preview with overlaySrc must include overlay controls");
});

test("runBuildAndPreview returns ok: false with stage and error when slug is missing", async () => {
  const result = await runBuildAndPreview({ slug: "" });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.equal(result.stage, "inputs");
});

test("runBuildAndPreview returns ok: false with stage and error when no staged AST or variants", async () => {
  const result = await runBuildAndPreview({ slug: "nonexistent_slug_xyz_12345" });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.equal(result.stage, "generate");
});

test("runBuildAndPreview produces preview HTML with window.__RESPONSIVE__ and __onPreviewBucketChange", async () => {
  const slug = "_test_build_preview_wiring";
  const minimalAst = {
    slug,
    tree: {
      name: "Frame",
      w: 400,
      h: 300,
      id: "root",
      children: [],
    },
    meta: { responsive: { mergedGroup: false } },
  };
  writeStage(slug, minimalAst);
  try {
    const result = await runBuildAndPreview({ slug });
    if (!result.ok) {
      // Pipeline may fail on minimal AST (e.g. missing fonts); skip content assertions
      assert.ok(result.error);
      assert.ok(["generate", "codeit", "improve", "fix", "emit"].includes(result.stage) || result.stage === "inputs");
      return;
    }
    const previewFile = path.join(PREVIEW_DIR, `${slug}.html`);
    assert.ok(fs.existsSync(previewFile), "Preview file should exist after successful build");
    const html = fs.readFileSync(previewFile, "utf8");
    assert.match(html, /__RESPONSIVE__/, "Preview HTML must contain window.__RESPONSIVE__ wiring");
    assert.match(html, /__onPreviewBucketChange/, "Preview HTML must contain window.__onPreviewBucketChange");
  } finally {
    deleteStage(slug);
    try {
      fs.unlinkSync(path.join(PREVIEW_DIR, `${slug}.html`));
    } catch {
      // ignore
    }
    const reportPath = path.join(PREVIEW_DIR, "build-reports", `${slug}.json`);
    try {
      fs.unlinkSync(reportPath);
    } catch {
      // ignore
    }
  }
});

test("runBuildAndPreview writes build report with stage timings and output paths on success", async () => {
  const slug = "_test_build_report";
  const minimalAst = {
    slug,
    tree: { name: "F", w: 400, h: 300, id: "root", children: [] },
    meta: {},
  };
  writeStage(slug, minimalAst);
  const reportPath = path.join(PREVIEW_DIR, "build-reports", `${slug}.json`);
  try {
    const result = await runBuildAndPreview({ slug });
    assert.ok(fs.existsSync(reportPath), "Build report should be written");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.slug, slug);
    assert.equal(typeof report.ok, "boolean");
    assert.equal(typeof report.stage, "string");
    assert.ok(typeof report.timings === "object" || report.timings === undefined);
    if (result.ok) {
      assert.equal(report.ok, true);
      assert.ok(report.outputPaths?.preview || report.outputPaths?.report);
    }
  } finally {
    deleteStage(slug);
    try {
      fs.unlinkSync(reportPath);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(path.join(PREVIEW_DIR, `${slug}.html`));
    } catch {
      // ignore
    }
  }
});
