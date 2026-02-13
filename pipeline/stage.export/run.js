const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const { assertValidArtifact } = require("../artifacts/validate");
const { evaluate } = require("../services/evaluate");
const { readInputArtifact } = require("./io");
const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  removeAttr,
  setAttrValue,
  setClassTokens,
} = require("../stage.codeit/contracts/utils/html");

const repoRoot = path.resolve(__dirname, "..", "..");

const loadExportModule = async (relativePath) => {
  const fullPath = path.resolve(repoRoot, "generator", relativePath);
  return import(pathToFileURL(fullPath).href);
};

const resolveComponentsRoot = (componentsRoot) => {
  if (!componentsRoot) return path.resolve(repoRoot, "components");
  return path.isAbsolute(componentsRoot)
    ? componentsRoot
    : path.resolve(repoRoot, componentsRoot);
};

const normalizeOps = (patch) => {
  if (!patch) return null;
  const ops = patch.ops && typeof patch.ops === "object" ? patch.ops : patch;
  return {
    classAdd: Array.isArray(ops.classAdd) ? ops.classAdd : [],
    classRemove: Array.isArray(ops.classRemove) ? ops.classRemove : [],
    classReplace: ops.classReplace && typeof ops.classReplace === "object" ? ops.classReplace : {},
    attrAdd: ops.attrAdd && typeof ops.attrAdd === "object" ? ops.attrAdd : {},
    attrRemove: Array.isArray(ops.attrRemove) ? ops.attrRemove : [],
  };
};

const applyStagePatches = (html, patches) => {
  const source = String(html || "");
  if (!source || !Array.isArray(patches) || !patches.length) return source;

  const nodes = parseHtmlNodes(source);
  const patchesByNode = new Map();

  nodes.forEach((node, index) => {
    if (!node?.attrs) return;
    const nodeId = getAttrValue(node.attrs, "data-node-id") || getAttrValue(node.attrs, "data-key");
    if (!nodeId) return;
    patchesByNode.set(String(nodeId), index);
  });

  const changed = new Set();
  const safeAria = new Set(["aria-label", "aria-labelledby", "aria-describedby", "aria-hidden"]);

  patches.forEach((patch) => {
    const nodeId = String(patch?.nodeId || "").trim();
    if (!nodeId) return;
    const nodeIndex = patchesByNode.get(nodeId);
    if (nodeIndex === undefined) return;
    const node = nodes[nodeIndex];
    const ops = normalizeOps(patch);
    if (!ops) return;

    const tokens = getClassTokens(node.attrs);
    const tokenSet = new Set(tokens);

    ops.classAdd.forEach((token) => {
      const t = String(token || "").trim();
      if (t) tokenSet.add(t);
    });

    ops.classRemove.forEach((token) => {
      const t = String(token || "").trim();
      if (t) tokenSet.delete(t);
    });

    Object.entries(ops.classReplace).forEach(([from, to]) => {
      const fr = String(from || "").trim();
      const tt = String(to || "").trim();
      if (!fr || !tt) return;
      if (tokenSet.has(fr)) {
        tokenSet.delete(fr);
        tokenSet.add(tt);
      }
    });

    const nextTokens = Array.from(tokenSet);
    setClassTokens(node.attrs, node.attrOrder, nextTokens);

    Object.entries(ops.attrAdd).forEach(([key, value]) => {
      const k = String(key || "").trim();
      if (!k) return;
      if (k.startsWith("aria-") && !safeAria.has(k)) return;
      if (!k.startsWith("aria-")) return;
      setAttrValue(node.attrs, node.attrOrder, k, String(value));
    });

    ops.attrRemove.forEach((key) => {
      const k = String(key || "").trim();
      if (!k) return;
      if (k.startsWith("aria-") && !safeAria.has(k)) return;
      if (!k.startsWith("aria-")) return;
      removeAttr(node.attrs, node.attrOrder, k);
    });

    changed.add(nodeIndex);
  });

  if (!changed.size) return source;
  const openTagPatches = [];
  changed.forEach((nodeIndex) => {
    const node = nodes[nodeIndex];
    openTagPatches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
  });

  return applyPatches(source, openTagPatches);
};

const shouldStripAttr = (key) => {
  const name = String(key || "").toLowerCase();
  if (!name.startsWith("data-")) return false;

  const exact = new Set([
    "data-node-id",
    "data-key",
    "data-node",
    "data-bg-fit",
    "data-bg-pos",
  ]);

  if (exact.has(name)) return true;
  if (name.startsWith("data-group-bg-")) return true;
  if (name.startsWith("data-group-ov-")) return true;
  if (name.startsWith("data-ov-")) return true;
  if (name.startsWith("data-debug")) return true;
  if (name.startsWith("data-figma")) return true;
  if (name.startsWith("data-h-intent")) return true;
  if (name.startsWith("data-w-intent")) return true;
  if (name.startsWith("data-bounds")) return true;

  return false;
};

const stripInstrumentationAttrs = (html) => {
  const source = String(html || "");
  if (!source) return source;

  const nodes = parseHtmlNodes(source);
  const openTagPatches = [];

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const keys = [...node.attrOrder];
    let changed = false;

    keys.forEach((key) => {
      if (shouldStripAttr(key)) {
        removeAttr(node.attrs, node.attrOrder, key);
        changed = true;
      }
    });

    if (changed) {
      openTagPatches.push(
        createPatch(
          node.openStart,
          node.openEnd,
          buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
        )
      );
    }
  });

  return applyPatches(source, openTagPatches);
};

const resolveExportType = (artifact) => {
  const candidates = [
    process.env.EXPORT_TYPE,
    process.env.EXPORT_COMPONENT_TYPE,
    process.env.COMPONENT_TYPE,
    artifact?.assets?.export?.type,
  ];
  const found = candidates.find((value) => String(value || "").trim());
  return String(found || "section").trim();
};

const resolveA11yTotal = (metrics) => {
  if (!metrics || !metrics.breakpoints) return 0;
  const totals = ["mobile", "tablet", "desktop"].map(
    (bp) => Number(metrics?.breakpoints?.[bp]?.a11y?.total || 0) || 0
  );
  return Math.max(...totals, 0);
};

const run = async ({ slug }) => {
  const inputArtifact = readInputArtifact(slug);
  assertValidArtifact(inputArtifact);

  const evaluation = inputArtifact.metrics?.breakpoints ? inputArtifact.metrics : evaluate({
    slug,
    html: inputArtifact.html,
  }).metrics;

  const a11yTotal = resolveA11yTotal(evaluation);
  if (a11yTotal > 0) {
    const msg = `Export blocked: ${a11yTotal} a11y violation(s) detected.`;
    if (process.env.EXPORT_ALLOW_A11Y === "1") {
      console.warn(msg);
    } else {
      throw new Error(msg);
    }
  }

  const exportMod = await loadExportModule("export/index.js");
  const {
    extractPreviewFragment,
    selectRootFragment,
    writeHeroPhp,
    writeAcfHeroPhp,
    getNextComponentId,
    copyOverlayImages,
  } = exportMod;

  const baseHtml = typeof inputArtifact.html === "string" ? inputArtifact.html : "";
  const patchedHtml = applyStagePatches(baseHtml, Array.isArray(inputArtifact.patches) ? inputArtifact.patches : []);

  const fragment = extractPreviewFragment(patchedHtml);
  const rootFragment = selectRootFragment(fragment);
  const sanitized = stripInstrumentationAttrs(rootFragment);

  const componentsRoot = resolveComponentsRoot(process.env.EXPORT_COMPONENTS_ROOT || "");
  const type = resolveExportType(inputArtifact);

  const typeDir = path.join(componentsRoot, type);
  fs.mkdirSync(typeDir, { recursive: true });

  const id = getNextComponentId(typeDir);
  const componentBaseName = `${type}_${id}`;
  const outputDir = path.join(typeDir, id);
  fs.mkdirSync(outputDir, { recursive: true });

  const heroPath = writeHeroPhp({
    outputDir,
    componentBaseName,
    type,
    sanitizedHtml: sanitized,
  });

  const acfPath = writeAcfHeroPhp({
    outputDir,
    componentBaseName,
    type,
    id,
  });

  const imagePaths = copyOverlayImages({
    slug,
    destDir: outputDir,
    componentBaseName,
  });

  return {
    ok: true,
    type,
    id,
    folder: outputDir,
    files: [heroPath, acfPath, ...imagePaths],
  };
};

module.exports = {
  run,
};
