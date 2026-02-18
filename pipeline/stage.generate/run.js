const path = require("path");
const { pathToFileURL } = require("url");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION, assertValidArtifact } = require(
  "../artifacts/validate"
);
const { evaluate } = require("../services/evaluate");
const { writeArtifact } = require("./io");

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const loadGeneratorModule = async (relativePath) => {
  const fullPath = path.resolve(__dirname, "..", "..", "generator", relativePath);
  return import(pathToFileURL(fullPath).href);
};

const normalizeResponsiveAssets = (assets) => {
  if (!isPlainObject(assets)) return null;

  const out = {};

  if (isPlainObject(assets.mobile) || isPlainObject(assets.tablet) || isPlainObject(assets.desktop)) {
    ["mobile", "tablet", "desktop"].forEach((key) => {
      const entry = assets[key];
      if (!isPlainObject(entry)) return;
      const overlay = String(entry.overlay || "").trim();
      const bg = String(entry.bg || "").trim();
      if (overlay || bg) {
        out[key] = {
          ...(overlay ? { overlay } : {}),
          ...(bg ? { bg } : {}),
        };
      }
    });
  } else if (isPlainObject(assets.overlay) || isPlainObject(assets.bg)) {
    ["mobile", "tablet", "desktop"].forEach((key) => {
      const overlay = String(assets?.overlay?.[key] || "").trim();
      const bg = String(assets?.bg?.[key] || "").trim();
      if (overlay || bg) {
        out[key] = {
          ...(overlay ? { overlay } : {}),
          ...(bg ? { bg } : {}),
        };
      }
    });
  }

  return Object.keys(out).length ? out : null;
};

const extractAssets = (ast) => {
  const assets = {};
  const fonts = [];
  const seenFonts = new Set();

  const addFont = (family, weights) => {
    const name = String(family || "").trim();
    if (!name) return;
    const weightList = Array.isArray(weights) ? weights.filter(Boolean) : [];
    const key = `${name}:${weightList.join(",")}`;
    if (seenFonts.has(key)) return;
    const entry = { family: name };
    if (weightList.length) entry.weights = weightList;
    fonts.push(entry);
    seenFonts.add(key);
  };

  if (Array.isArray(ast?.meta?.fonts)) {
    ast.meta.fonts.forEach((font) => addFont(font?.family, font?.weights));
  } else if (isPlainObject(ast?.meta?.fontMap)) {
    Object.keys(ast.meta.fontMap).forEach((family) => addFont(family));
  }

  if (fonts.length) {
    assets.fonts = fonts;
  }

  const images = {};
  const responsiveAssets = normalizeResponsiveAssets(ast?.meta?.responsive?.assets);
  if (responsiveAssets) {
    images.responsive = responsiveAssets;
  }

  const overlaySrc = String(ast?.meta?.overlay?.src || "").trim();
  if (overlaySrc) images.overlay = overlaySrc;

  const bgSrc = String(ast?.__bg?.src || ast?.meta?.bg?.src || "").trim();
  if (bgSrc) images.background = bgSrc;

  if (Object.keys(images).length) {
    assets.images = images;
  }

  return assets;
};

const buildMinimalNodeIndex = (html) => {
  const markup = String(html || "");
  if (!markup) return null;

  const regex = /data-node-id\s*=\s*["']([^"']+)["']/gi;
  const ids = new Set();
  let match = regex.exec(markup);

  while (match) {
    const value = String(match[1] || "").trim();
    if (value) ids.add(value);
    match = regex.exec(markup);
  }

  if (!ids.size) return null;

  const index = {};
  ids.forEach((id) => {
    const safeId = String(id).replace(/"/g, '\\"');
    index[id] = [`[data-node-id="${safeId}"]`];
  });

  return index;
};

const resolveNodeIndex = (ast, fragmentHtml) => {
  if (isPlainObject(ast?.nodeIndex)) return ast.nodeIndex;
  if (isPlainObject(ast?.meta?.nodeIndex)) return ast.meta.nodeIndex;
  return buildMinimalNodeIndex(fragmentHtml);
};

const run = async ({ slug }) => {
  const { readStage } = await loadGeneratorModule("server/stageStore.js");
  const { buildPreviewFragment } = await loadGeneratorModule("server/fragmentPipeline.js");
  const { normalizeAst } = await loadGeneratorModule("auto/normalizeAst.js");
  const { buildIntentGraph } = await loadGeneratorModule("auto/intentGraphPass.js");
  const { autoLayoutify } = await loadGeneratorModule("auto/autoLayoutify/index.js");
  const { semanticAccessiblePass } = await loadGeneratorModule("auto/phase2SemanticPass.js");
  const { preventNestedInteractive } = await loadGeneratorModule("auto/preventNestedInteractive.js");
  const { interactiveStatesPass } = await loadGeneratorModule("auto/interactiveStatesPass.js");
  const { previewHtml } = await loadGeneratorModule("templates/preview.html.js");

  const staged = readStage(slug);
  if (!staged?.ast) {
    throw new Error(
      `No staged AST found for "${slug}". Expected generator staging at generator/.preview/staging/staging/${slug}.json.`
    );
  }

  const result = await buildPreviewFragment({
    astInput: staged.ast,
    normalizeAst,
    buildIntentGraph,
    autoLayoutify,
    semanticAccessiblePass,
    preventNestedInteractive,
    interactiveStatesPass,
    previewHtml,
    previewOnly: false,
  });

  if (!result.ok) {
    throw new Error(result.error || "Generate stage failed.");
  }

  const assets = extractAssets(result.ast);
  const nodeIndex = resolveNodeIndex(result.ast, result.fragment);
  const evaluation = evaluate({
    slug,
    html: result.preview,
    fragment: result.fragment,
    assets,
    nodeIndex,
    ast: result.ast,
  });

  const artifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "generate",
    createdAt: new Date().toISOString(),
    html: String(result.preview || result.fragment || ""),
    patches: [],
    assets,
    diagnostics: isPlainObject(evaluation?.diagnostics) ? evaluation.diagnostics : {},
    metrics: isPlainObject(evaluation?.metrics) ? evaluation.metrics : {},
  };

  if (nodeIndex) {
    artifact.nodeIndex = nodeIndex;
  }

  assertValidArtifact(artifact);
  writeArtifact(slug, artifact);

  return artifact;
};

module.exports = {
  run,
};
