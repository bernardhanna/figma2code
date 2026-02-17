import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createApp } from "../createApp.js";
import { VDIFF_DIR } from "../runtimePaths.js";

import { normalizeAst } from "../../auto/normalizeAst.js";
import { buildIntentGraph } from "../../auto/intentGraphPass.js";
import { autoLayoutify } from "../../auto/autoLayoutify/index.js";
import { semanticAccessiblePass } from "../../auto/phase2SemanticPass.js";
import { interactiveStatesPass } from "../../auto/interactiveStatesPass.js";
import { preventNestedInteractive } from "../../auto/preventNestedInteractive.js";
import { learnedRulesPass } from "../../auto/learnedRulesPass.js";
import { previewHtml } from "../../templates/preview.html.js";
import { renderOneFragment } from "../fragmentPipeline.js";

function makeApp(port) {
  const deps = {
    normalizeAst,
    buildIntentGraph,
    autoLayoutify,
    semanticAccessiblePass,
    interactiveStatesPass,
    preventNestedInteractive,
    learnedRulesPass,
    previewHtml,
    renderOneFragment,
  };
  return createApp({ port, deps });
}

test("refine-structure endpoint writes report and marks rollback on worsened score in dryRun test mode", async () => {
  const port = 5699;
  const app = makeApp(port);
  const server = app.listen(port, "127.0.0.1");
  const slug = "_refine_structure_test_mode";
  const outDir = path.join(VDIFF_DIR, slug);
  const reportPath = path.join(outDir, "refine-structure-report.desktop.json");

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/refine-structure/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "desktop",
        dryRun: true,
        forceEditScript: {
          version: 1,
          bucket: "desktop",
          targetRootId: "root",
          ops: [{ op: "setClasses", nodeId: "root", classAdd: ["grid"], classRemove: [], classReplace: {} }],
        },
        testMode: {
          beforeDiffRatio: 0.12,
          afterDiffRatio: 0.25, // worse => rollback expected
          targetRootId: "root",
        },
      }),
    });

    const json = await res.json();
    assert.equal(res.status, 409);
    assert.equal(json.ok, false);
    assert.equal(json.rollback, true);
    assert.ok(Array.isArray(json.iterations));
    assert.ok(fs.existsSync(reportPath));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {}
  }
});
