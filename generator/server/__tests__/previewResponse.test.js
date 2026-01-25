import test from "node:test";
import assert from "node:assert/strict";

import { buildPreviewResponse } from "../previewResponse.js";

test("buildPreviewResponse includes previewUrl and screenshotUrl", () => {
  const payload = buildPreviewResponse({
    previewUrl: "/preview/demo",
    screenshotUrl: "/preview-screens/demo.png",
    screenshotUrls: {
      desktop: "/preview-screens/demo-desktop.png",
      tablet: "/preview-screens/demo-tablet.png",
      mobile: "/preview-screens/demo-mobile.png",
    },
    report: { warnings: [], errors: [], fixes: [] },
    paths: { preview: "/tmp/demo.html" },
    result: { phase2Report: null, responsive: null },
  });

  assert.equal(payload.previewUrl, "/preview/demo");
  assert.equal(payload.screenshotUrl, "/preview-screens/demo.png");
  assert.equal(payload.screenshotUrls.desktop, "/preview-screens/demo-desktop.png");
  assert.equal(payload.ok, true);
});
