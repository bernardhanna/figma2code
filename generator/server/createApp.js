// generator/server/createApp.js

import express from "express";

import { corsMiddleware } from "./corsMiddleware.js";
import { ensureRuntimeDirs, ASSETS_DIR, VDIFF_DIR } from "./runtimePaths.js";

import { registerHomeRoutes } from "./routesHome.js";
import { registerConfigRoutes } from "./routesConfig.js";
import { registerUploadRoutes } from "./routesUpload.js";
import { registerPhase1Routes } from "./routesPhase1.js";

// IMPORTANT: do NOT import registerCompareRoute from ./routes/compareRoute.js
// Compare is implemented inside registerVisualDiffAndAutofixRoutes
import { registerPreviewAndGenerateRoutes } from "./routesPreviewAndGenerate.js";
import { registerVisualDiffAndAutofixRoutes } from "./routesVisualDiffAndAutofix.js";

export function createApp({ port }) {
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

  return app;
}
