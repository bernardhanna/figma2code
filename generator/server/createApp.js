// generator/server/createApp.js
import express from "express";

import { corsMiddleware } from "./corsMiddleware.js";
import { ensureRuntimeDirs, ASSETS_DIR, VDIFF_DIR } from "./runtimePaths.js";

import { registerHomeRoutes } from "./routesHome.js";
import { registerConfigRoutes } from "./routesConfig.js";
import { registerUploadRoutes } from "./routesUpload.js";
import { registerPhase1Routes } from "./routesPhase1.js";
import { registerPreviewAndGenerateRoutes } from "./routesPreviewAndGenerate.js";
import { registerVisualDiffAndAutofixRoutes } from "./routesVisualDiffAndAutofix.js";
import { registerExportRoutes } from "./routesExport.js";

import { registerBatchUploadRoutes } from "./routesBatchUpload.js";

/**
 * createApp({ port, deps })
 * deps must include:
 * - normalizeAst
 * - buildIntentGraph
 * - autoLayoutify
 * - semanticAccessiblePass
 * - preventNestedInteractive
 * - previewHtml
 * - renderOneFragment
 * - buildMergedResponsivePreview (optional; batch route can import directly too)
 */
export function createApp({ port, deps }) {
  ensureRuntimeDirs();

  const app = express();

  // CORS (Figma plugin origin can be "null")
  app.use(corsMiddleware());

  // Body parsing
  app.use(express.json({ limit: "50mb" }));

  // Static
  app.use("/assets", express.static(ASSETS_DIR));
  app.use("/fixtures.out", express.static(VDIFF_DIR));

  // Routes
  registerHomeRoutes(app);
  registerConfigRoutes(app);
  registerUploadRoutes(app);
  registerPhase1Routes(app);

  registerPreviewAndGenerateRoutes(app, { port });
  registerVisualDiffAndAutofixRoutes(app, { port });
  registerExportRoutes(app);

  // Batch upload (Option B: one-click export all variants)
  registerBatchUploadRoutes(app, deps);

  return app;
}
