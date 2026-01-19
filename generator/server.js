// generator/server.js
import "dotenv/config";

import { getConfig } from "./config/env.js";
import { createApp } from "./server/createApp.js";

// Pipeline deps (the same ones you already use in routesPreviewAndGenerate / fragmentPipeline)
import { normalizeAst } from "./auto/normalizeAst.js";
import { buildIntentGraph } from "./auto/intentGraphPass.js";
import { autoLayoutify } from "./auto/autoLayoutify/index.js";
import { semanticAccessiblePass } from "./auto/phase2SemanticPass.js";
import { interactiveStatesPass } from "./auto/interactiveStatesPass.js";

// If you have preventNestedInteractive in your codebase, import it here.
// If not, pass null and the helper will simply skip it.
import { preventNestedInteractive } from "./auto/preventNestedInteractive.js"; // adjust if your path differs

import { previewHtml } from "./templates/preview.html.js";

// We must export renderOneFragment from fragmentPipeline.js (see step 3)
import { renderOneFragment } from "./server/fragmentPipeline.js";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { initComponentLibrary } from "./componentLibrary/index.js";

// Fail fast if AI_PROVIDER or required API keys are invalid
getConfig();

const port = 5173;

const DEBUG_COMPONENT_LIB = String(process.env.COMPONENT_LIB_DEBUG || "").trim() === "1";

// Initialize canonical component library index once at startup.
// NOTE: routesPreviewAndGenerate uses fragmentPipeline directly; fragmentPipeline reads this singleton.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const componentsDir = path.resolve(repoRoot, "components");

initComponentLibrary({ componentsDir, debug: DEBUG_COMPONENT_LIB });

const deps = {
  normalizeAst,
  buildIntentGraph,
  autoLayoutify,
  semanticAccessiblePass,
  interactiveStatesPass,
  preventNestedInteractive: preventNestedInteractive || null,
  previewHtml,
  renderOneFragment,
};

const app = createApp({ port, deps });

app.listen(port, () => console.log(`Generator running: http://localhost:${port}`));
