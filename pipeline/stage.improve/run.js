const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION, assertValidArtifact } = require(
  "../artifacts/validate"
);
const { evaluate: defaultEvaluate } = require("../services/evaluate");
const {
  getArtifactPath,
  readInputArtifact,
  writeArtifact,
  writeHistorySnapshot,
} = require("./io");
const config = require("./stage.config");
const {
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
} = require("../stage.codeit/contracts/utils/html");
const { applyPatchPlan, validatePatch } = require("./utilities/patches");
const {
  isProtectedMediaNode,
  canProveClipping,
  isHeightTokenGuarded,
  guardedHeightPatchFilter,
} = require("./utilities/heightGuard");
const { createReporter, IMPROVE } = require("../progress");
const {
  proposePatchOps: proposeDedupeWidthPatchOps,
} = require("../stage.codeit/contracts/layout/width/dedupeWidths");

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const HEIGHT_TOKEN = /^(min-h|h)-\[[0-9.]+rem\]$/;
const OVERFLOW_X_TOKEN = /^overflow-x-/;

const MEDIA_TAGS = new Set([
  "img",
  "video",
  "picture",
  "source",
  "svg",
  "canvas",
  "iframe",
  "embed",
  "object",
  "figure",
]);

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "textarea", "select", "label"]);
const VISUAL_BREAKPOINTS = ["mobile", "tablet", "desktop"];

const nodeIdForNode = (node) =>
  getAttrValue(node.attrs, "data-node-id") ||
  getAttrValue(node.attrs, "data-key") ||
  null;

const selectorForNode = (node) => {
  const dataNodeId = getAttrValue(node.attrs, "data-node-id");
  if (dataNodeId) {
    return `[data-node-id="${String(dataNodeId).replace(/"/g, '\\"')}"]`;
  }
  const dataKey = getAttrValue(node.attrs, "data-key");
  if (dataKey) {
    return `[data-key="${String(dataKey).replace(/"/g, '\\"')}"]`;
  }
  return "";
};

const labelFromNode = (node) => {
  const key = getAttrValue(node.attrs, "data-key");
  if (key) {
    const cleaned = String(key)
      .replace(/[:#]/g, " ")
      .replace(/[_-]+/g, " ")
      .trim();
    if (cleaned) return cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1);
  }
  if (node.tag === "button") return "Button";
  if (node.tag === "a") return "Link";
  return "Action";
};

const normalizeToken = (token) => String(token || "").split(":").pop();

const isInteractiveButtonLike = (node, tokens) => {
  const tag = String(node?.tag || "").toLowerCase();
  if (tag === "button") return true;
  const role = String(getAttrValue(node?.attrs || {}, "role") || "").trim().toLowerCase();
  if (role === "button") return true;
  return (Array.isArray(tokens) ? tokens : []).some((t) => normalizeToken(t) === "btn");
};

const parseHexColor = (hex) => {
  const raw = String(hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    return { r, g, b };
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
};

const luminance = ({ r, g, b }) => 0.2126 * Number(r || 0) + 0.7152 * Number(g || 0) + 0.0722 * Number(b || 0);

const isDarkBackgroundCore = (coreToken) => {
  const core = String(coreToken || "").trim().toLowerCase();
  if (!core.startsWith("bg-")) return false;
  if (core === "bg-black") return true;
  if (core === "bg-slate-900" || core === "bg-gray-900" || core === "bg-zinc-900") return true;
  const hexMatch = core.match(/^bg-\[(#[0-9a-f]{3}|#[0-9a-f]{6})\]$/i);
  if (!hexMatch) return false;
  const rgb = parseHexColor(hexMatch[1]);
  if (!rgb) return false;
  return luminance(rgb) < 140;
};

const hasExplicitTextColorClass = (tokens) =>
  (Array.isArray(tokens) ? tokens : []).some((token) => {
    const core = normalizeToken(token);
    if (!core.startsWith("text-")) return false;
    if (
      /^(text-(left|right|center|justify|start|end|xs|sm|base|lg|xl|[2-9]xl|balance|pretty|wrap|nowrap|ellipsis|clip))$/.test(
        core
      )
    ) {
      return false;
    }
    if (/^text-\[[0-9.]+(px|rem|em|%)\]$/.test(core)) return false;
    return true;
  });

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent === null || parent === undefined) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const hasMediaDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (MEDIA_TAGS.has(node.tag)) return true;
    const kids = childrenMap.get(idx) || [];
    queue.push(...kids);
  }
  return false;
};

const extractInnerText = (html, node) => {
  if (!node || node.closeStart === null) return "";
  const raw = String(html || "").slice(node.openEnd, node.closeStart);
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const collectNodeMap = (html) => {
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const map = new Map();

  nodes.forEach((node, index) => {
    if (!node?.attrs) return;
    const id = nodeIdForNode(node);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, {
        node,
        nodeIndex: index,
        tokens: getClassTokens(node.attrs),
        innerText: extractInnerText(html, node),
        hasMedia: hasMediaDescendant(nodes, childrenMap, index),
        context: { nodes, childrenMap, nodeIndex: index },
      });
    }
  });
  return { nodeMap: map, nodes, childrenMap };
};

const buildPatch = (nodeId, selector, iteration) => ({
  nodeId,
  selector,
  stage: "improve",
  iteration,
  ops: {
    classAdd: [],
    classRemove: [],
    classReplace: {},
    attrAdd: {},
    attrRemove: [],
  },
});

const recordLedger = (entry, op, value, reason) => {
  const key = `${op}:${value}`;
  if (entry.seenOps.has(key)) return;
  entry.seenOps.add(key);
  entry.ledgerEntries.push({
    contractId: "improve",
    nodeId: entry.patch.nodeId,
    selector: entry.patch.selector,
    op,
    value,
    reason,
  });
};

const addClassRemove = (entry, token, reason) => {
  if (!token) return;
  if (!entry.patch.ops.classRemove.includes(token)) {
    entry.patch.ops.classRemove.push(token);
  }
  recordLedger(entry, "classRemove", token, reason);
};

const addClassAdd = (entry, token, reason) => {
  const t = String(token || "").trim();
  if (!t) return;
  if (!entry.patch.ops.classAdd.includes(t)) {
    entry.patch.ops.classAdd.push(t);
  }
  recordLedger(entry, "classAdd", t, reason);
};

const addAttrAdd = (entry, key, value, reason) => {
  const k = String(key || "").trim();
  if (!k) return;
  if (!entry.patch.ops.attrAdd[k]) {
    entry.patch.ops.attrAdd[k] = String(value ?? "");
  }
  recordLedger(entry, "attrAdd", `${k}=${entry.patch.ops.attrAdd[k]}`, reason);
};

const addAttrRemove = (entry, key, reason) => {
  const k = String(key || "").trim();
  if (!k) return;
  if (!entry.patch.ops.attrRemove.includes(k)) {
    entry.patch.ops.attrRemove.push(k);
  }
  recordLedger(entry, "attrRemove", k, reason);
};

const addClassReplace = (entry, fromToken, toToken, reason) => {
  const from = String(fromToken || "").trim();
  const to = String(toToken || "").trim();
  if (!from || !to || from === to) return;
  entry.patch.ops.classReplace[from] = to;
  recordLedger(entry, "classReplace", `${from}=>${to}`, reason);
};

const hasBoundedOps = (patch) => {
  const ops = patch?.ops || {};
  return (
    (Array.isArray(ops.classAdd) && ops.classAdd.length > 0) ||
    (Array.isArray(ops.classRemove) && ops.classRemove.length > 0) ||
    (isPlainObject(ops.classReplace) && Object.keys(ops.classReplace).length > 0) ||
    (isPlainObject(ops.attrAdd) && Object.keys(ops.attrAdd).length > 0) ||
    (Array.isArray(ops.attrRemove) && ops.attrRemove.length > 0)
  );
};

const SPACING_SCALE = [
  "0",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "14",
  "16",
  "20",
  "24",
];

const splitTokenPrefix = (token) => {
  const raw = String(token || "").trim();
  const idx = raw.lastIndexOf(":");
  if (idx < 0) return { prefix: "", core: raw };
  return { prefix: raw.slice(0, idx + 1), core: raw.slice(idx + 1) };
};

const spacingCorePattern = /^(p[trblxy]?|gap(?:-[xy])?)-([0-9]+(?:\.5)?)$/;
const widthRemPattern = /^(w|max-w)-\[([0-9]+(?:\.[0-9]+)?)rem\]$/;

const proposeSpacingTweak = (token, hint) => {
  const { prefix, core } = splitTokenPrefix(token);
  const m = core.match(spacingCorePattern);
  if (!m) return { replacement: null, candidateOps: 0 };
  const scaleIdx = SPACING_SCALE.indexOf(m[2]);
  if (scaleIdx < 0) return { replacement: null, candidateOps: 0 };
  const candidates = [scaleIdx - 1, scaleIdx + 1, scaleIdx - 2, scaleIdx + 2]
    .filter((i, idx, arr) => i >= 0 && i < SPACING_SCALE.length && arr.indexOf(i) === idx);
  if (!candidates.length) return { replacement: null, candidateOps: 0 };
  const hintText = String(hint || "").toLowerCase();
  const wantsLess = /(too\s+large|excess|wide|loose|big)/i.test(hintText);
  const wantsMore = /(too\s+small|tight|cramp|narrow)/i.test(hintText);
  let pick = candidates[0];
  if (wantsLess) {
    pick =
      candidates.find((i) => i < scaleIdx) ??
      candidates.find((i) => i > scaleIdx) ??
      candidates[0];
  } else if (wantsMore) {
    pick =
      candidates.find((i) => i > scaleIdx) ??
      candidates.find((i) => i < scaleIdx) ??
      candidates[0];
  }
  const replacementCore = `${m[1]}-${SPACING_SCALE[pick]}`;
  if (replacementCore === core) return { replacement: null, candidateOps: candidates.length };
  return { replacement: `${prefix}${replacementCore}`, candidateOps: candidates.length };
};

const parseWidthRemToken = (token) => {
  const { prefix, core } = splitTokenPrefix(token);
  const m = core.match(widthRemPattern);
  if (!m) return null;
  return {
    raw: token,
    prefix,
    core,
    kind: m[1],
    rem: Number(m[2]),
  };
};

const isWidthToken = (token) => {
  const core = normalizeToken(token);
  return /^(w|max-w|min-w|basis)-/.test(core) || core === "grow" || /^grow-\d+$/.test(core) || core === "shrink" || /^shrink-\d+$/.test(core);
};

const metricMissingVisualDiff = (metric) =>
  !metric ||
  typeof metric?.value !== "number" ||
  String(metric?.source || "").trim().toLowerCase() === "placeholder";

const missingVisualBuckets = (metrics, buckets = VISUAL_BREAKPOINTS) =>
  buckets.filter((bp) => metricMissingVisualDiff(metrics?.breakpoints?.[bp]?.visual?.pixelDiffRatio));

const resolveRepoRoot = () => path.resolve(__dirname, "..", "..");

const resolvePipelineOutDir = (slug) =>
  path.join(resolveRepoRoot(), "fixtures.out", String(slug || "").trim());

const resolveGeneratorOutDir = (slug) =>
  path.join(resolveRepoRoot(), "generator", "fixtures.out", String(slug || "").trim());

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const copyIfExists = (src, dst, copied) => {
  if (!src || !dst || !fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  if (Array.isArray(copied)) copied.push(dst);
  return true;
};

const mirrorVisualDiffArtifactsToPipelineDir = (slug) => {
  const copied = [];
  const srcDir = resolveGeneratorOutDir(slug);
  const dstDir = resolvePipelineOutDir(slug);
  if (!fs.existsSync(srcDir)) {
    return { copied, sourceDir: srcDir, targetDir: dstDir };
  }
  const candidates = [
    "figma.png",
    "figma.mobile.png",
    "figma.tablet.png",
    "figma.desktop.png",
    "render.png",
    "render.mobile.png",
    "render.tablet.png",
    "render.desktop.png",
    "diff.png",
    "diff.mobile.png",
    "diff.tablet.png",
    "diff.desktop.png",
    "score.json",
    "score.mobile.json",
    "score.tablet.json",
    "score.desktop.json",
    "score.all.json",
  ];
  candidates.forEach((file) => {
    copyIfExists(path.join(srcDir, file), path.join(dstDir, file), copied);
  });
  return { copied, sourceDir: srcDir, targetDir: dstDir };
};

const resolveRefCandidates = (slug, bucket) => {
  const key = String(bucket || "desktop").toLowerCase();
  const pipelineDir = resolvePipelineOutDir(slug);
  const generatorDir = resolveGeneratorOutDir(slug);
  const suffixes = key === "desktop" ? ["desktop", "", "mobile"] : [key, "", "desktop"];
  const names = [];
  suffixes.forEach((s) => {
    if (s) names.push(`figma.${s}.png`);
    else names.push("figma.png");
  });
  const files = [];
  [pipelineDir, generatorDir].forEach((dir) => {
    names.forEach((name) => files.push(path.join(dir, name)));
  });
  return files;
};

const readFirstExistingPng = (paths) => {
  for (const file of paths) {
    if (!fs.existsSync(file)) continue;
    try {
      const { PNG } = require("pngjs");
      return { file, png: PNG.sync.read(fs.readFileSync(file)) };
    } catch (error) {
      return { file, png: null, error: String(error?.message || error) };
    }
  }
  return { file: null, png: null, error: null };
};

const resolvePlaywrightExecutable = () => {
  const explicit = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const base = String(process.env.PLAYWRIGHT_BROWSERS_PATH || "").trim();
  if (!base || !fs.existsSync(base)) return null;
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((name) => /^chromium(?:_headless_shell)?-\d+/.test(name));
  } catch (_error) {
    return null;
  }
  dirs.sort().reverse();
  const relCandidates = [
    "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
    "chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const dir of dirs) {
    for (const rel of relCandidates) {
      const full = path.join(base, dir, rel);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
};

const captureRenderFromHtml = async ({ html, viewport, selector }) => {
  const { chromium } = require("playwright");
  const executablePath = resolvePlaywrightExecutable();
  const launchOptions = executablePath ? { executablePath } : {};
  const browser = await chromium.launch(launchOptions);
  let selectorUsed = String(selector || "#cmp_root");
  try {
    const page = await browser.newPage({ viewport });
    await page.setContent(String(html || ""), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(350);
    let shotBuffer = null;
    const el = await page.$(selectorUsed);
    if (el) {
      shotBuffer = await el.screenshot({ type: "png" });
    } else {
      selectorUsed = "full-page";
      shotBuffer = await page.screenshot({ fullPage: true, type: "png" });
    }
    return { ok: true, buffer: shotBuffer, selectorUsed };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), selectorUsed };
  } finally {
    await browser.close().catch(() => {});
  }
};

const runLocalVisualDiffGeneration = async ({ slug, html, buckets = VISUAL_BREAKPOINTS }) => {
  const requested = Array.isArray(buckets) && buckets.length ? buckets : VISUAL_BREAKPOINTS;
  const outDir = resolvePipelineOutDir(slug);
  ensureDir(outDir);
  const filesWritten = [];
  const warnings = [];
  const { PNG } = require("pngjs");
  const pixelmatchMod = await import("pixelmatch");
  const pixelmatch = pixelmatchMod?.default || pixelmatchMod;
  const results = {};

  const cropToMinLocal = (a, b) => {
    const w = Math.max(1, Math.min(Number(a?.width || 0), Number(b?.width || 0)));
    const h = Math.max(1, Math.min(Number(a?.height || 0), Number(b?.height || 0)));
    const ac = new PNG({ width: w, height: h });
    const bc = new PNG({ width: w, height: h });
    PNG.bitblt(a, ac, 0, 0, w, h, 0, 0);
    PNG.bitblt(b, bc, 0, 0, w, h, 0, 0);
    return { w, h, ac, bc };
  };

  for (const bucket of requested) {
    const refCandidates = resolveRefCandidates(slug, bucket);
    const ref = readFirstExistingPng(refCandidates);
    if (!ref.png) {
      warnings.push(
        `missing-reference-${bucket}: no figma ref found in ${refCandidates.slice(0, 4).join(" | ")}${
          ref.error ? ` (parse error: ${ref.error})` : ""
        }`
      );
      continue;
    }
    copyIfExists(ref.file, path.join(outDir, `figma.${bucket}.png`), filesWritten);
    const viewport = {
      width: Math.max(320, Number(ref.png.width || 1200)),
      height: Math.max(900, Number(ref.png.height || 900) + 140),
    };
    const render = await captureRenderFromHtml({ html, viewport, selector: "#cmp_root" });
    if (!render.ok || !render.buffer) {
      warnings.push(`playwright-${bucket}: ${render.error || "unknown render failure"}`);
      continue;
    }
    const renderPng = PNG.sync.read(render.buffer);
    const { w, h, ac: refCrop, bc: renderCrop } = cropToMinLocal(ref.png, renderPng);
    const diffPng = new PNG({ width: w, height: h });
    const diffPixels = pixelmatch(refCrop.data, renderCrop.data, diffPng.data, w, h, {
      threshold: 0.1,
      includeAA: true,
    });
    const totalPixels = w * h;
    const diffRatio = totalPixels ? diffPixels / totalPixels : 1;
    const score = {
      slug,
      mode: bucket,
      viewport,
      crop: { width: w, height: h },
      diffPixels,
      totalPixels,
      diffRatio,
      pass: diffRatio <= 0.03,
      compare: { threshold: 0.1, includeAA: true, passDiffRatio: 0.03 },
      screenshot: { selectorUsed: render.selectorUsed },
      figma: { path: ref.file, width: ref.png.width, height: ref.png.height },
      at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outDir, `render.${bucket}.png`), render.buffer);
    filesWritten.push(path.join(outDir, `render.${bucket}.png`));
    fs.writeFileSync(path.join(outDir, `diff.${bucket}.png`), PNG.sync.write(diffPng));
    filesWritten.push(path.join(outDir, `diff.${bucket}.png`));
    fs.writeFileSync(path.join(outDir, `score.${bucket}.json`), JSON.stringify(score, null, 2), "utf8");
    filesWritten.push(path.join(outDir, `score.${bucket}.json`));
    results[bucket] = score;
  }

  if (results.desktop) {
    copyIfExists(path.join(outDir, "render.desktop.png"), path.join(outDir, "render.png"), filesWritten);
    copyIfExists(path.join(outDir, "diff.desktop.png"), path.join(outDir, "diff.png"), filesWritten);
    copyIfExists(path.join(outDir, "score.desktop.json"), path.join(outDir, "score.json"), filesWritten);
  }
  if (Object.keys(results).length) {
    const allPath = path.join(outDir, "score.all.json");
    fs.writeFileSync(allPath, JSON.stringify({ slug, at: new Date().toISOString(), results }, null, 2), "utf8");
    filesWritten.push(allPath);
  }
  return {
    ok: Object.keys(results).length > 0,
    mode: "local",
    results,
    warnings,
    filesWritten,
    outDir,
  };
};

const missingPipelineScoreBuckets = (slug, buckets = VISUAL_BREAKPOINTS) => {
  const outDir = resolvePipelineOutDir(slug);
  const list = Array.isArray(buckets) && buckets.length ? buckets : VISUAL_BREAKPOINTS;
  const missing = list.filter((bp) => !fs.existsSync(path.join(outDir, `score.${bp}.json`)));
  return { outDir, missing };
};

const defaultEnsureVisualDiff = async ({
  slug,
  html,
  buckets = VISUAL_BREAKPOINTS,
  preferLocalHtml = false,
}) => {
  if (preferLocalHtml && String(html || "").trim()) {
    return runLocalVisualDiffGeneration({ slug, html, buckets });
  }
  const preMirror = mirrorVisualDiffArtifactsToPipelineDir(slug);
  const preMirrorMissing = missingPipelineScoreBuckets(slug, buckets);
  if (preMirrorMissing.missing.length === 0) {
    return {
      ok: true,
      mode: "mirror-existing",
      status: 0,
      body: null,
      requestUrl: null,
      filesWritten: preMirror.copied,
      mirrorSourceDir: preMirror.sourceDir,
      mirrorTargetDir: preMirror.targetDir,
      outDir: preMirror.targetDir,
    };
  }
  const origin =
    process.env.IMPROVE_COMPARE_ORIGIN ||
    process.env.PREVIEW_ORIGIN ||
    `http://127.0.0.1:${process.env.PORT || 5173}`;
  const url = `${String(origin).replace(/\/+$/, "")}/api/compare/${encodeURIComponent(slug)}`;
  let response = null;
  let body = null;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ multi: true }),
    });
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const ok = response.ok && body && body.ok !== false;
    if (ok) {
      const mirrored = mirrorVisualDiffArtifactsToPipelineDir(slug);
      return {
        ok: true,
        mode: "api",
        status: response.status,
        body,
        requestUrl: url,
        filesWritten: mirrored.copied,
        mirrorSourceDir: mirrored.sourceDir,
        mirrorTargetDir: mirrored.targetDir,
      };
    }
  } catch (error) {
    // API compare may be unavailable when running pipeline standalone.
    body = { error: String(error?.message || error) };
  }
  const local = await runLocalVisualDiffGeneration({ slug, html, buckets });
  if (local.ok) {
    return {
      ok: true,
      mode: "local",
      status: response?.status || 0,
      body,
      requestUrl: url,
      filesWritten: local.filesWritten,
      warnings: local.warnings,
      outDir: local.outDir,
      results: local.results,
    };
  }
  return {
    ok: false,
    mode: "local",
    status: response?.status || 0,
    body,
    requestUrl: url,
    error:
      `visual diff unavailable via API and local fallback failed` +
      `${local?.warnings?.length ? `: ${local.warnings.join(" ; ")}` : ""}`,
    warnings: local.warnings || [],
    filesWritten: local.filesWritten || [],
    outDir: local.outDir || resolvePipelineOutDir(slug),
  };
};

const generateDeterministicPlan = ({
  html,
  offenders,
  nodeIndex,
  iteration,
  limit,
  getMeasurements = () => ({}),
}) => {
  const { nodeMap, nodes, childrenMap } = collectNodeMap(html);
  const entries = new Map();
  const diagnostics = [];
  const warnings = [];
  let clippingSkipped = false;
  const strategyStats = new Map();

  const bumpStrategy = (name, deltaAttempted = 0, deltaCandidateOps = 0) => {
    const key = String(name || "").trim();
    if (!key) return;
    if (!strategyStats.has(key)) {
      strategyStats.set(key, { name: key, attempted: 0, candidateOps: 0 });
    }
    const row = strategyStats.get(key);
    row.attempted += Number(deltaAttempted || 0);
    row.candidateOps += Number(deltaCandidateOps || 0);
  };

  const ensureEntry = (nodeId, selector) => {
    if (!entries.has(nodeId)) {
      entries.set(nodeId, {
        patch: buildPatch(nodeId, selector, iteration),
        ledgerEntries: [],
        seenOps: new Set(),
      });
    }
    const entry = entries.get(nodeId);
    if (selector && !entry.patch.selector) entry.patch.selector = selector;
    return entry;
  };

  const resolveNodeEntryForOffender = (offender) => {
    const rawNodeId = String(offender?.nodeId || "").trim();
    if (!rawNodeId) return null;
    const direct = nodeMap.get(rawNodeId);
    if (direct) return { nodeId: rawNodeId, nodeEntry: direct };
    const indexMatch = rawNodeId.match(/^[a-z]+@(\d+)$/i);
    let node = null;
    let idx = -1;
    if (indexMatch) {
      const parsed = Number(indexMatch[1]);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed < nodes.length) {
        idx = parsed;
        node = nodes[idx];
      }
    }
    if (!node && /^div@/i.test(rawNodeId)) {
      const candidates = nodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => String(n?.tag || "").toLowerCase() === "div")
        .filter(({ n }) => getClassTokens(n?.attrs || []).some((t) => /^w-\[[0-9.]+rem\]$/.test(normalizeToken(t))))
        .filter(({ n, i }) => {
          const widthToken = getClassTokens(n?.attrs || []).find((t) =>
            /^w-\[[0-9.]+rem\]$/.test(normalizeToken(t))
          );
          const rem = Number((String(widthToken || "").match(/^w-\[([0-9.]+)rem\]$/) || [])[1] || 0);
          if (!Number.isFinite(rem) || rem <= 0) return false;
          let p = n?.parentIndex;
          let sawMx = false;
          let sawWFull = false;
          let sawMax = false;
          while (p != null && nodes[p]) {
            const pt = getClassTokens(nodes[p].attrs || []).map((t) => normalizeToken(t));
            if (pt.includes("mx-auto")) sawMx = true;
            if (pt.includes("w-full")) sawWFull = true;
            if (pt.includes(`max-w-[${rem}rem]`)) sawMax = true;
            p = nodes[p].parentIndex;
          }
          return sawMx && sawWFull && sawMax;
        });
      if (candidates.length === 1) {
        idx = candidates[0].i;
        node = candidates[0].n;
      }
    }
    if (!node) return null;
    const dataNodeId = nodeIdForNode(node);
    const resolvedId = String(dataNodeId || rawNodeId || `${String(node?.tag || "node")}@${idx}`);
    return {
      nodeId: resolvedId,
      nodeEntry: {
        node,
        nodeIndex: idx,
        tokens: getClassTokens(node.attrs || []),
        innerText: extractInnerText(html, node),
        hasMedia: hasMediaDescendant(nodes, childrenMap, idx),
        context: { nodes, childrenMap, nodeIndex: idx },
      },
    };
  };

  const topOffenders = offenders.slice(0, limit);
  const hasWidthConflictOffenders = topOffenders.some((off) => {
    const hint = String(off?.hint || "").toLowerCase();
    const suggested = String(off?.suggestedContract || "").toLowerCase();
    return /conflicting width utilities/.test(hint) || suggested === "layout/width/dedupewidths";
  });

  topOffenders.forEach((offender) => {
    const resolved = resolveNodeEntryForOffender(offender);
    if (!resolved?.nodeId || !resolved?.nodeEntry) {
      warnings.push(`Missing node for offender ${offender?.nodeId}.`);
      return;
    }
    const nodeId = resolved.nodeId;
    const nodeEntry = resolved.nodeEntry;

    const offenderSelector = String(offender.selector || "").trim();
    const selector =
      (/^[a-z][a-z0-9-]*$/i.test(offenderSelector) ? "" : offenderSelector) ||
      (nodeIndex && Array.isArray(nodeIndex[nodeId]) ? nodeIndex[nodeId][0] : "") ||
      selectorForNode(nodeEntry.node);

    const tokens = nodeEntry.tokens;
    const parentNode =
      nodeEntry.node?.parentIndex === null || nodeEntry.node?.parentIndex === undefined
        ? null
        : nodes[nodeEntry.node.parentIndex] || null;
    const parentTokens = parentNode?.attrs ? getClassTokens(parentNode.attrs) : [];
    const parentNormalized = parentTokens.map((t) => normalizeToken(t));
    const ancestorTokens = [];
    let parentScan =
      nodeEntry.node?.parentIndex === null || nodeEntry.node?.parentIndex === undefined
        ? null
        : nodeEntry.node.parentIndex;
    while (parentScan != null && nodes[parentScan]) {
      const anc = nodes[parentScan];
      if (anc?.attrs) ancestorTokens.push(...getClassTokens(anc.attrs));
      parentScan = anc?.parentIndex === null || anc?.parentIndex === undefined ? null : anc.parentIndex;
    }
    const ancestorNormalized = ancestorTokens.map((t) => normalizeToken(t));
    const offenderHint = String(offender?.hint || "");
    const offenderKindText = offenderKind(offender).toLowerCase();
    const offenderSignal = `${offenderHint} ${offenderKindText}`.toLowerCase();
    const suggestedContract = String(offender?.suggestedContract || "");
    const isWidthConflictOffender =
      /conflicting width utilities/.test(offenderSignal) ||
      suggestedContract === "layout/width/dedupeWidths";

    let note = "";

    if (!note && offender.suggestedContract === "layout/width/dedupeWidths") {
      bumpStrategy("width-dedupe", 1, 0);
      const ops = proposeDedupeWidthPatchOps({
        tokens,
        parentTokens,
        isWrapper: ["div", "section", "header", "main", "nav", "article", "aside"].includes(
          String(nodeEntry.node?.tag || "").toLowerCase()
        ),
      });
      if (ops && (ops.classRemove?.length || Object.keys(ops.classReplace || {}).length)) {
        const patchEntry = ensureEntry(nodeId, selector);
        (ops.classRemove || []).forEach((token) =>
          addClassRemove(
            patchEntry,
            token,
            "Patch: deduped conflicting width utilities"
          )
        );
        Object.entries(ops.classReplace || {}).forEach(([fromToken, toToken]) =>
          addClassReplace(
            patchEntry,
            fromToken,
            toToken,
            "Patch: normalized conflicting width utilities"
          )
        );
        bumpStrategy(
          "width-dedupe",
          0,
          (ops.classRemove || []).length + Object.keys(ops.classReplace || {}).length
        );
        note = "Deduped conflicting width utilities";
      }
    }

    if (!note && /conflicting width|width/.test(offenderSignal)) {
      const widthToken = tokens.map(parseWidthRemToken).find((tok) => tok && tok.kind === "w");
      if (widthToken) {
        const remToken = Number.isFinite(widthToken.rem) ? widthToken.rem.toString() : "";
        const ancestorSameMaxW = remToken
          ? ancestorNormalized.some((tok) => tok === `max-w-[${remToken}rem]`)
          : false;
        const ancestorCentered = ancestorNormalized.includes("mx-auto");
        const ancestorWFull = ancestorNormalized.includes("w-full");
        const candidateOps = ancestorSameMaxW && ancestorCentered && ancestorWFull ? 2 : 0;
        bumpStrategy("container-width-canonicalize", 1, candidateOps);
        if (candidateOps > 0) {
          const patchEntry = ensureEntry(nodeId, selector);
          addClassRemove(
            patchEntry,
            widthToken.raw,
            `Patch: remove redundant fixed width ${widthToken.raw}; ancestor max-w/mx-auto already constrains container`
          );
          if (!tokens.some((t) => normalizeToken(t) === "w-full")) {
            addClassAdd(patchEntry, `${widthToken.prefix}w-full`, "Patch: canonicalize to fill width");
          }
          note = `Container width canonicalized (${widthToken.raw} removed).`;
        }
      }
    }

    if (!note && isWidthConflictOffender) {
      const normalized = tokens.map((t) => normalizeToken(t));
      const maxW = tokens.find((t) => /^max-w-\[[0-9.]+rem\]$/.test(normalizeToken(t)));
      const fixedW = tokens.find((t) => /^w-\[[0-9.]+rem\]$/.test(normalizeToken(t)));
      const hasWFull = normalized.includes("w-full");
      const hasSelfStart = normalized.includes("self-start");
      const parentFillColumn =
        parentNormalized.includes("flex-col") &&
        (parentNormalized.includes("grow") ||
          parentNormalized.includes("basis-0") ||
          parentNormalized.includes("min-w-0"));
      const widthIntent = String(getAttrValue(nodeEntry.node?.attrs || {}, "data-w-intent") || "")
        .trim()
        .toLowerCase();
      const isFillIntent = widthIntent === "fill" || parentFillColumn;
      const redundantMaxWUnderParentConstraint =
        hasWFull &&
        Boolean(maxW) &&
        (parentNormalized.includes("w-full") ||
          parentNormalized.some((t) => /^max-w-\[[0-9.]+rem\]$/.test(t)) ||
          ancestorNormalized.some((t) => /^max-w-\[[0-9.]+rem\]$/.test(t)));
      let candidateOps = 0;
      if (isFillIntent && hasWFull && maxW) candidateOps += 1;
      else if (redundantMaxWUnderParentConstraint) candidateOps += 1;
      else if (isFillIntent && fixedW) candidateOps += 1;
      else if (isFillIntent && hasSelfStart) candidateOps += 1;
      if (isFillIntent && hasSelfStart && !hasWFull) candidateOps += 1;
      bumpStrategy("width-dedupe-smart", 1, candidateOps);
      if (candidateOps > 0) {
        const patchEntry = ensureEntry(nodeId, selector);
        if (isFillIntent && hasWFull && maxW) {
          addClassRemove(
            patchEntry,
            maxW,
            "Patch: remove redundant max-w under fill column width conflict"
          );
        } else if (redundantMaxWUnderParentConstraint && maxW) {
          addClassRemove(
            patchEntry,
            maxW,
            "Patch: remove redundant max-w; parent/ancestor already constrains width"
          );
        } else if (isFillIntent && fixedW) {
          addClassRemove(
            patchEntry,
            fixedW,
            "Patch: remove fixed width under fill column width conflict"
          );
        } else if (isFillIntent && hasSelfStart) {
          addClassRemove(patchEntry, "self-start", "Patch: remove self-start for fill width intent");
        }
        if (isFillIntent && hasSelfStart && !hasWFull) {
          addClassAdd(patchEntry, "w-full", "Patch: enforce fill width intent");
        }
        note = "Applied width-dedupe-smart for conflicting width offender.";
      }
    }

    if (!note && !isWidthConflictOffender && /conflicting width|width|spacing|gap|padding/.test(offenderSignal)) {
      const gapToken = tokens.find((t) => {
        const sp = splitTokenPrefix(t);
        return !sp.prefix && /^gap(?:-[xy])?-([0-9]+(?:\.5)?)$/.test(sp.core);
      });
      if (gapToken) {
        const { replacement } = proposeSpacingTweak(gapToken, "too large");
        const replCore = replacement ? splitTokenPrefix(replacement).core : "";
        const maxMdToken = replCore ? `max-md:${replCore}` : "";
        const candidateOps = maxMdToken && !tokens.includes(maxMdToken) ? 1 : 0;
        bumpStrategy("spacing-step-tune", 1, candidateOps);
        if (candidateOps > 0) {
          const patchEntry = ensureEntry(nodeId, selector);
          addClassAdd(
            patchEntry,
            maxMdToken,
            `Patch: tune mobile spacing by one Tailwind step (${gapToken} -> ${maxMdToken})`
          );
          note = `Added ${maxMdToken} for mobile spacing tune.`;
        }
      }
    }

    if (
      !note &&
      !isWidthConflictOffender &&
      (/spacing|padding|gap/.test(offenderSignal) ||
        suggestedContract.includes("layout/spacing"))
    ) {
      const spacingToken = tokens.find((t) => spacingCorePattern.test(splitTokenPrefix(t).core));
      if (spacingToken) {
        const { replacement, candidateOps } = proposeSpacingTweak(spacingToken, offenderHint);
        bumpStrategy("layout-spacing-tweak", 1, candidateOps);
        if (replacement) {
          const patchEntry = ensureEntry(nodeId, selector);
          addClassReplace(
            patchEntry,
            spacingToken,
            replacement,
            `Patch: spacing tweak near ${spacingToken}`
          );
          note = `Adjusted spacing token: ${spacingToken} -> ${replacement}`;
        }
      }
    }

    if (
      !note &&
      !isWidthConflictOffender &&
      (/width|cta|button|fill|stretch/.test(offenderSignal) ||
        suggestedContract.includes("layout/width"))
    ) {
      const normalized = tokens.map((t) => normalizeToken(t));
      const fixedWidth = tokens.filter((t) => /^w-\[[0-9.]+rem\]$/.test(normalizeToken(t)));
      const hasSelfCenter = normalized.includes("self-center");
      const hasSelfStretch = normalized.includes("self-stretch");
      const hasWFull = normalized.includes("w-full");
      const parentFlexCol = parentNormalized.includes("flex-col");
      const ctaLike = /cta|button/.test(offenderSignal);
      const canApplyFill = ctaLike || parentFlexCol;
      const candidateOps =
        (fixedWidth.length ? 1 : 0) +
        (hasSelfCenter ? 1 : 0) +
        (!hasSelfStretch && canApplyFill ? 1 : 0) +
        (!hasWFull && canApplyFill ? 1 : 0);
      bumpStrategy("layout-width-fill", 1, candidateOps);
      if (candidateOps > 0 && canApplyFill) {
        const patchEntry = ensureEntry(nodeId, selector);
        fixedWidth.forEach((token) => {
          addClassRemove(patchEntry, token, "Patch: fixed width removed for fill strategy");
        });
        if (hasSelfCenter) {
          addClassRemove(patchEntry, "self-center", "Patch: center self-align removed");
        }
        if (!hasSelfStretch) {
          addClassAdd(patchEntry, "self-stretch", "Patch: stretch self-align for fill");
        }
        if (!hasWFull) {
          addClassAdd(patchEntry, "w-full", "Patch: full width for fill");
        }
        note = "Applied width fill strategy (w-full/self-stretch).";
      }
    }

    if (
      !note &&
      !isWidthConflictOffender &&
      (/align|alignment|justify|items|center/.test(offenderSignal) ||
        suggestedContract.includes("layout/align"))
    ) {
      const patchEntry = ensureEntry(nodeId, selector);
      const normalized = tokens.map((t) => normalizeToken(t));
      const itemsToken = tokens.find((t) => /^items-(start|center|end|stretch)$/.test(normalizeToken(t)));
      const justifyToken = tokens.find((t) =>
        /^justify-(start|center|end|between|around|evenly)$/.test(normalizeToken(t))
      );
      const hintLower = offenderSignal;
      const wantsEnd = /(end|right|bottom)/.test(hintLower);
      const wantsCenter = /(center|middle)/.test(hintLower);
      const wantsStart = /(start|left|top)/.test(hintLower);
      const targetItems = wantsCenter ? "items-center" : wantsEnd ? "items-end" : wantsStart ? "items-start" : "items-center";
      const targetJustify = wantsCenter ? "justify-center" : wantsEnd ? "justify-end" : wantsStart ? "justify-start" : "justify-center";
      let candidateOps = 0;
      if (itemsToken) candidateOps += 3;
      if (justifyToken) candidateOps += 5;
      if (!itemsToken && !justifyToken) candidateOps += 2;
      bumpStrategy("layout-align-swap", 1, candidateOps);
      if (itemsToken && normalizeToken(itemsToken) !== targetItems) {
        addClassReplace(patchEntry, itemsToken, targetItems, "Patch: alignment item-axis swap");
      } else if (!itemsToken) {
        addClassAdd(patchEntry, targetItems, "Patch: alignment item-axis add");
      }
      if (justifyToken && normalizeToken(justifyToken) !== targetJustify) {
        addClassReplace(patchEntry, justifyToken, targetJustify, "Patch: alignment justify-axis swap");
      } else if (!justifyToken) {
        addClassAdd(patchEntry, targetJustify, "Patch: alignment justify-axis add");
      }
      if (hasBoundedOps(patchEntry.patch)) {
        note = "Applied flex alignment swap strategy.";
      }
    }

    if (
      !note &&
      /repeating|repeat|matrix|grid|cards?/.test(offenderSignal)
    ) {
      const patchEntry = ensureEntry(nodeId, selector);
      const gridToken = tokens.find((t) => normalizeToken(t) === "grid");
      const flexToken = tokens.find((t) => normalizeToken(t) === "flex");
      const flexWrapToken = tokens.find((t) => normalizeToken(t) === "flex-wrap");
      const gridColsTokens = tokens.filter((t) => /^grid-cols-/.test(normalizeToken(t)));
      let candidateOps = 0;
      if (gridToken) candidateOps += 2;
      if (flexToken) candidateOps += 2;
      if (gridColsTokens.length) candidateOps += 1;
      bumpStrategy("layout-flex-grid-swap", 1, candidateOps);
      if (flexToken && flexWrapToken) {
        addClassReplace(patchEntry, flexToken, "grid", "Patch: swap flex to grid for repeating layout");
        addClassRemove(patchEntry, flexWrapToken, "Patch: remove flex-wrap after grid swap");
        if (!tokens.some((t) => /^grid-cols-/.test(normalizeToken(t)))) {
          addClassAdd(patchEntry, "grid-cols-2", "Patch: provide baseline grid columns");
        }
      } else if (gridToken) {
        addClassReplace(patchEntry, gridToken, "flex", "Patch: swap grid to flex for repeating layout");
        addClassAdd(patchEntry, "flex-wrap", "Patch: enable wrapping after flex swap");
        gridColsTokens.forEach((tok) =>
          addClassRemove(patchEntry, tok, "Patch: remove explicit grid-cols after flex swap")
        );
      }
      if (hasBoundedOps(patchEntry.patch)) {
        note = "Applied optional flex/grid swap strategy.";
      }
    }

    if (offender.category === "layout" && /fixed height/i.test(offender.hint || "")) {
      bumpStrategy("layout-fixed-height", 1, 0);
      const patchEntry = ensureEntry(nodeId, selector);
      if (MEDIA_TAGS.has(nodeEntry.node.tag)) return;
      if (nodeEntry.hasMedia) return;
      if (isProtectedMediaNode(nodeEntry.node, nodeEntry.context)) return;

      const measurements = getMeasurements(nodeId);
      if (!canProveClipping(nodeEntry.node, measurements)) {
        if (!clippingSkipped) {
          warnings.push("clipping check unavailable; skipped height removal");
          clippingSkipped = true;
        }
        return;
      }

      const removals = tokens.filter((token) => isHeightTokenGuarded(token) || HEIGHT_TOKEN.test(normalizeToken(token)));
      removals.forEach((token) => {
        addClassRemove(
          patchEntry,
          token,
          `Patch: removed ${token} (proven clipping)`
        );
      });
      bumpStrategy("layout-fixed-height", 0, removals.length);
      if (removals.length) {
        note = `Removed fixed height classes (proven clipping): ${removals.join(", ")}`;
      }
    }

    if (!note && offender.category === "layout" && /overflow-x/i.test(offender.hint || "")) {
      bumpStrategy("layout-overflow-x", 1, 0);
      const patchEntry = ensureEntry(nodeId, selector);
      const removals = tokens.filter((token) => OVERFLOW_X_TOKEN.test(normalizeToken(token)));
      removals.forEach((token) => {
        addClassRemove(
          patchEntry,
          token,
          `Patch: removed ${token} (overflow containment)`
        );
      });
      bumpStrategy("layout-overflow-x", 0, removals.length);
      if (removals.length) {
        note = `Removed overflow-x classes: ${removals.join(", ")}`;
      }
    }

    if (
      !note &&
      offender.category === "a11y" &&
      /interactive element/i.test(offender.hint || "")
    ) {
      bumpStrategy("a11y-interactive-name", 1, 0);
      const patchEntry = ensureEntry(nodeId, selector);
      const ariaLabel = getAttrValue(nodeEntry.node.attrs, "aria-label");
      const ariaLabelledBy = getAttrValue(nodeEntry.node.attrs, "aria-labelledby");
      const title = getAttrValue(nodeEntry.node.attrs, "title");
      const innerText = nodeEntry.innerText || "";
      if (!ariaLabel && !ariaLabelledBy && !title && !innerText) {
        const label = labelFromNode(nodeEntry.node);
        addAttrAdd(
          patchEntry,
          "aria-label",
          label,
          `Patch: added aria-label="${label}" (missing accessible name)`
        );
        bumpStrategy("a11y-interactive-name", 0, 1);
        note = `Added aria-label="${label}"`;
      }
    }

    if (!note && offender.category === "a11y" && /image missing alt/i.test(offender.hint || "")) {
      bumpStrategy("a11y-image-decorative", 1, 0);
      const patchEntry = ensureEntry(nodeId, selector);
      const ariaHidden = getAttrValue(nodeEntry.node.attrs, "aria-hidden");
      const alt = getAttrValue(nodeEntry.node.attrs, "alt");
      if (ariaHidden !== "true" && (!alt || !String(alt).trim())) {
        addAttrAdd(
          patchEntry,
          "aria-hidden",
          "true",
          'Patch: added aria-hidden="true" (decorative image)'
        );
        bumpStrategy("a11y-image-decorative", 0, 1);
        note = 'Added aria-hidden="true"';
      }
    }

    if (note) {
      const patchEntry = entries.get(nodeId);
      if (!patchEntry) return;
      diagnostics.push({
        iteration,
        nodeId,
        selector: patchEntry.patch.selector,
        offender,
        ops: patchEntry.patch.ops,
        note,
      });
    }
  });

  // Deterministic a11y guard: ensure readable text color on dark interactive buttons.
  nodes.forEach((node, index) => {
    if (!node?.attrs) return;
    const nodeId = nodeIdForNode(node) || `${String(node?.tag || "node")}@${index}`;
    const selector = selectorForNode(node);
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;
    if (!isInteractiveButtonLike(node, tokens)) return;
    if (hasExplicitTextColorClass(tokens)) return;
    const bgCores = tokens.map((t) => normalizeToken(t)).filter((core) => /^bg-/.test(core));
    if (!bgCores.length) return;
    if (!bgCores.some((core) => isDarkBackgroundCore(core))) return;
    bumpStrategy("a11y-contrast-guard", 1, 1);
    const patchEntry = ensureEntry(nodeId, selector);
    addClassAdd(
      patchEntry,
      "text-white",
      "Patch: enforce readable text on dark background (contrast guard)"
    );
  });

  if (hasWidthConflictOffenders) {
    nodes.forEach((node, index) => {
      const attrs = node?.attrs || [];
      const nodeId = nodeIdForNode(node) || `${String(node?.tag || "node")}@${index}`;
      const selector = selectorForNode(node);
      const tokens = getClassTokens(attrs);
      const normalized = tokens.map((t) => normalizeToken(t));
      const children = childrenMap.get(index) || [];
      const hasImgChild = children.some((idx) => String(nodes[idx]?.tag || "").toLowerCase() === "img");

      if (
        (getAttrValue(attrs, "data-decorative") === "1" ||
          children.filter((idx) => {
            const ct = getClassTokens(nodes[idx]?.attrs || []).map((t) => normalizeToken(t));
            return ct.includes("grow") && ct.includes("basis-0");
          }).length >= 3) &&
        normalized.includes("flex") &&
        normalized.includes("justify-between") &&
        !tokens.some((t) => /^w-/.test(normalizeToken(t)))
      ) {
        const remFromNode = Number(getAttrValue(attrs, "data-w-rem"));
        const remFromChildren = children
          .map((idx) => Number(getAttrValue(nodes[idx]?.attrs || [], "data-w-rem")))
          .filter((v) => Number.isFinite(v) && v > 0)
          .reduce((sum, v) => sum + v, 0);
        const rem = Number.isFinite(remFromNode) && remFromNode > 0 ? remFromNode : remFromChildren;
        if (Number.isFinite(rem) && rem > 0) {
          const widthToken = `w-[${rem}rem]`;
          if (!tokens.includes(widthToken)) {
            const patchEntry = ensureEntry(nodeId, selector);
            addClassAdd(
              patchEntry,
              widthToken,
              "Patch: restore decorative bar container width from exported width metadata"
            );
            bumpStrategy("decorative-width-restore", 1, 1);
          }
        }
      }

      if (String(node?.tag || "").toLowerCase() === "img") {
        const patchEntry = ensureEntry(nodeId, selector);
        let changed = 0;
        if (tokens.includes("max-sm:h-auto")) {
          addClassReplace(
            patchEntry,
            "max-sm:h-auto",
            "max-md:h-auto",
            "Patch: broaden mobile image auto-height to md breakpoint"
          );
          changed += 1;
        }
        if (tokens.includes("max-sm:object-contain")) {
          addClassReplace(
            patchEntry,
            "max-sm:object-contain",
            "max-md:object-contain",
            "Patch: broaden mobile object-contain to md breakpoint"
          );
          changed += 1;
        }
        if (changed > 0) bumpStrategy("image-mobile-contain-md", 1, changed);
      }

      if (hasImgChild) {
        const fixedW = tokens.find((t) => /^w-\[[0-9.]+rem\]$/.test(normalizeToken(t)));
        const hasWFull = normalized.includes("w-full");
        if (fixedW) {
          const patchEntry = ensureEntry(nodeId, selector);
          addClassRemove(
            patchEntry,
            fixedW,
            "Patch: make media wrapper fluid while preserving max width"
          );
          if (!hasWFull) {
            addClassAdd(patchEntry, "w-full", "Patch: fluid media wrapper width");
          }
          const rem = Number((fixedW.match(/^w-\[([0-9.]+)rem\]$/) || [])[1] || 0);
          if (Number.isFinite(rem) && rem > 0) {
            const maxW = `max-w-[${rem}rem]`;
            if (!tokens.includes(maxW)) {
              addClassAdd(
                patchEntry,
                maxW,
                "Patch: preserve intended media max width after fluid conversion"
              );
            }
          }
          bumpStrategy("image-wrapper-fluid", 1, 2);
        }
      }
    });
  }

  return {
    entries: Array.from(entries.values()).filter((entry) => hasBoundedOps(entry.patch)),
    diagnostics,
    warnings,
    strategyStats: Array.from(strategyStats.values()),
  };
};

const selectPatchProvider = (stageConfig, generatePatchPlanFn) => {
  if (typeof generatePatchPlanFn === "function") {
    return { id: "custom", generate: generatePatchPlanFn };
  }
  const provider = String(process.env.IMPROVE_PROVIDER || stageConfig.provider || "rules")
    .trim()
    .toLowerCase();
  if (provider === "ai") {
    return {
      id: "ai",
      generate: () => ({
        entries: [],
        diagnostics: [],
        warnings: ["AI provider not configured; no patches generated."],
      }),
    };
  }
  return {
    id: "rules",
    generate: generateDeterministicPlan,
  };
};

const formatProviderLabel = (providerId) => {
  const id = String(providerId || "").trim().toLowerCase();
  if (!id) return "";
  if (id === "ai") return "AI";
  if (id === "rules") return "Rules";
  return id.slice(0, 1).toUpperCase() + id.slice(1);
};

const compactAreaContribution = (offender) => {
  const bbox = offender?.bbox && typeof offender.bbox === "object" ? offender.bbox : null;
  const w = Number(bbox?.w || bbox?.width || 0);
  const h = Number(bbox?.h || bbox?.height || 0);
  if (w > 0 && h > 0) return `${Math.round(w * h)}px2`;
  if (Number.isFinite(Number(offender?.areaContribution))) return String(Number(offender.areaContribution));
  if (Number.isFinite(Number(offender?.pixels))) return `${Math.round(Number(offender.pixels))}px`;
  if (Number.isFinite(Number(offender?.impact))) return `impact=${Number(offender.impact)}`;
  return "n/a";
};

const offenderKind = (offender) =>
  String(offender?.kind || offender?.type || offender?.category || "unknown");

const offenderTarget = (offender) => {
  const nodeId = String(offender?.nodeId || "").trim();
  if (nodeId) return nodeId;
  const selector = String(offender?.selector || "").trim();
  if (selector) return selector;
  return "unknown";
};

const formatOffenderLine = (offender) => {
  const kind = offenderKind(offender);
  const target = offenderTarget(offender);
  const bp = String(offender?.breakpoint || "all");
  const area = compactAreaContribution(offender);
  return `[${kind}] ${target} area=${area} bp=${bp}`;
};

const normalizeStrategyStats = (stats) => {
  if (!Array.isArray(stats)) return [];
  return stats
    .map((s) => ({
      name: String(s?.name || "").trim(),
      attempted: Number(s?.attempted || 0),
      candidateOps: Number(s?.candidateOps || 0),
    }))
    .filter((s) => s.name);
};

const summarizeZeroCandidates = ({
  skippedReason,
  skippedDetails,
  topOffenders,
  providerId,
  strategyStats,
}) => {
  if (skippedReason) {
    return `iteration skipped: ${skippedReason}${skippedDetails ? ` (${skippedDetails})` : ""}`;
  }
  if (!Array.isArray(topOffenders) || topOffenders.length === 0) {
    return "no offenders selected";
  }
  if (String(providerId || "") === "rules") {
    const attempted = strategyStats.reduce((acc, s) => acc + Number(s.attempted || 0), 0);
    const generated = strategyStats.reduce((acc, s) => acc + Number(s.candidateOps || 0), 0);
    if (attempted === 0) return "no strategies matched offender kinds";
    if (generated === 0) return "strategies matched offenders but generated zero bounded candidate ops";
  }
  return "provider returned zero candidates";
};

const resolveGateConfig = (gate) => {
  const base = isPlainObject(gate) ? gate : {};
  const maxVisualDeltaRaw = process.env.IMPROVE_VISUAL_TOLERANCE ?? base.maxVisualDelta;
  const maxVisualDelta = Number(maxVisualDeltaRaw);
  const requireImprovementRaw = process.env.IMPROVE_REQUIRE_IMPROVEMENT;
  return {
    enabled: base.enabled !== false,
    maxVisualDelta: Number.isFinite(maxVisualDelta) ? maxVisualDelta : 0,
    requireImprovement:
      typeof requireImprovementRaw === "string"
        ? requireImprovementRaw !== "0"
        : base.requireImprovement !== false,
  };
};

/**
 * Deterministic fallback score when visual diff is missing.
 * 100 - 2*overflowX - 1*conflictingWidth - 2*fixedHeightWrapper (no duplicate/proven counts in metrics).
 */
const buildFallbackScore = (metrics) => {
  if (!metrics?.breakpoints) return 100;
  const bp = metrics.breakpoints.desktop || metrics.breakpoints.mobile || metrics.breakpoints.tablet;
  const layout = bp?.layout || {};
  const overflowX = Number(layout.overflowXCount) || 0;
  const conflictingWidth = Number(layout.conflictingWidthCount) || 0;
  const fixedHeight = Number(layout.fixedHeightWrapperCount) || 0;
  const score = 100 - 2 * overflowX - 1 * conflictingWidth - 2 * fixedHeight;
  return Math.max(0, Math.min(100, score));
};

const assessScoreGate = (before, after, gate) => {
  const breakpoints = ["mobile", "tablet", "desktop"];
  const deltas = [];

  breakpoints.forEach((bp) => {
    const beforeRatio = before?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    const afterRatio = after?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    if (typeof beforeRatio !== "number" || typeof afterRatio !== "number") return;
    deltas.push({ bp, delta: afterRatio - beforeRatio, before: beforeRatio, after: afterRatio });
  });

  if (!deltas.length) {
    const fallbackBefore = buildFallbackScore(before);
    const fallbackAfter = buildFallbackScore(after);
    if (fallbackAfter < fallbackBefore) {
      return {
        accept: false,
        reason: `Score gate (fallback): regression score ${fallbackBefore} → ${fallbackAfter}.`,
      };
    }
    if (gate.requireImprovement && fallbackAfter <= fallbackBefore) {
      return { accept: false, reason: "Score gate (fallback): no improvement detected." };
    }
    return { accept: true, reason: "Score gate passed (fallback score)." };
  }

  const regression = deltas.find((entry) => entry.delta > gate.maxVisualDelta);
  if (regression) {
    return {
      accept: false,
      reason: `Score gate: regression on ${regression.bp} by +${regression.delta.toFixed(4)}.`,
    };
  }

  const improved = deltas.some((entry) => entry.delta < -gate.maxVisualDelta);
  if (gate.requireImprovement && !improved) {
    return { accept: false, reason: "Score gate: no visual improvement detected." };
  }

  return { accept: true, reason: "Score gate passed." };
};

const resolveHtmlEnvelope = (previewHtml) => {
  const html = String(previewHtml || "");
  const iframeMatch =
    html.match(/<iframe[^>]*\bsrcdoc="([\s\S]*?)"/i) ||
    html.match(/<iframe[^>]*\bsrcdoc='([\s\S]*?)'/i);
  if (!iframeMatch) {
    const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) {
      return {
        fragment: html,
        apply: (fragment) => String(fragment || ""),
      };
    }
    const bodyAttrs = bodyMatch[1] || "";
    const fragment = bodyMatch[2] || "";
    return {
      fragment,
      apply: (fragmentHtml) =>
        html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, () => {
          return `<body${bodyAttrs}>${String(fragmentHtml || "")}</body>`;
        }),
    };
  }

  const decodeSrcdoc = (value) =>
    String(value || "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

  const encodeSrcdoc = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const srcdocEscaped = iframeMatch[1] || "";
  const srcdoc = decodeSrcdoc(srcdocEscaped);
  const bodyMatch = srcdoc.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyAttrs = bodyMatch ? bodyMatch[1] || "" : "";
  const fragment = bodyMatch ? bodyMatch[2] || "" : srcdoc;

  return {
    fragment,
    apply: (fragmentHtml) => {
      const next = bodyMatch
        ? srcdoc.replace(/<body[^>]*>[\s\S]*?<\/body>/i, () => {
            return `<body${bodyAttrs}>${String(fragmentHtml || "")}</body>`;
          })
        : String(fragmentHtml || "");
      const encoded = encodeSrcdoc(next);
      return html.replace(/(<iframe[^>]*\bsrcdoc=)(["'])([\s\S]*?)\2/i, (match, pre, quote, value) => {
        const start = match.indexOf(value);
        if (start === -1) return match;
        return match.slice(0, start) + encoded + match.slice(start + value.length);
      });
    },
  };
};

const buildDeltas = (baseline, current) => {
  if (!baseline || !current) return {};
  const deltas = {};

  ["mobile", "tablet", "desktop"].forEach((bp) => {
    const before = baseline?.breakpoints?.[bp];
    const after = current?.breakpoints?.[bp];
    if (!before || !after) return;

    const beforeRatio = before?.visual?.pixelDiffRatio?.value;
    const afterRatio = after?.visual?.pixelDiffRatio?.value;

    deltas[bp] = {
      visual: {
        pixelDiffRatio: {
          before: typeof beforeRatio === "number" ? beforeRatio : null,
          after: typeof afterRatio === "number" ? afterRatio : null,
          delta:
            typeof beforeRatio === "number" && typeof afterRatio === "number"
              ? afterRatio - beforeRatio
              : null,
        },
      },
      layout: {
        fixedHeightWrapperCount:
          (after?.layout?.fixedHeightWrapperCount || 0) -
          (before?.layout?.fixedHeightWrapperCount || 0),
        overflowXCount:
          (after?.layout?.overflowXCount || 0) - (before?.layout?.overflowXCount || 0),
        conflictingWidthCount:
          (after?.layout?.conflictingWidthCount || 0) -
          (before?.layout?.conflictingWidthCount || 0),
      },
      type: {
        wrapAnomalyCount:
          (after?.type?.wrapAnomalyCount || 0) - (before?.type?.wrapAnomalyCount || 0),
      },
      a11y: {
        total: (after?.a11y?.total || 0) - (before?.a11y?.total || 0),
      },
    };
  });

  return deltas;
};

const summarizeLedger = (entries) => {
  const groups = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const reason = String(entry?.reason || "Patch updates").trim() || "Patch updates";
    if (!groups.has(reason)) {
      groups.set(reason, { reason, count: 0, nodes: new Set() });
    }
    const group = groups.get(reason);
    group.count += 1;
    if (entry?.nodeId) group.nodes.add(entry.nodeId);
  });
  return Array.from(groups.values()).map((group) => ({
    reason: group.reason,
    count: group.count,
    nodes: Array.from(group.nodes),
  }));
};

const formatFixLine = (group) => {
  const reason = String(group?.reason || "").trim();
  if (!reason) return "";
  const nodes = Array.isArray(group?.nodes) ? group.nodes : [];
  if (!nodes.length) return reason;
  const list = nodes.slice(0, 4).join(", ");
  const suffix = nodes.length > 4 ? ", …" : "";
  return `${reason} (nodes: ${list}${suffix})`;
};

const formatRatio = (value) =>
  typeof value === "number" ? value.toFixed(4) : "—";

const formatDelta = (value) => {
  if (typeof value !== "number") return "—";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(4)}`;
};

const hashInput = (artifact) => {
  const json = JSON.stringify(artifact || {});
  return crypto.createHash("sha256").update(json).digest("hex");
};

const readExistingArtifact = (slug) => {
  const existingPath = getArtifactPath(slug);
  if (!fs.existsSync(existingPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(existingPath, "utf8"));
  } catch {
    return null;
  }
};

const run = async ({
  slug,
  evaluateFn = defaultEvaluate,
  readInputArtifactFn = readInputArtifact,
  readExistingArtifactFn = readExistingArtifact,
  writeArtifactFn = writeArtifact,
  writeHistorySnapshotFn = writeHistorySnapshot,
  generatePatchPlanFn,
  ensureVisualDiffFn = defaultEnsureVisualDiff,
  configOverride,
  log = console.log,
} = {}) => {
  const logFn = typeof log === "function" ? log : () => {};
  const reporter = createReporter(logFn);
  const stageConfig = configOverride ? { ...config, ...configOverride } : config;

  reporter.succeed(IMPROVE.LOAD_ARTIFACT);
  const inputArtifact = readInputArtifactFn(slug);
  assertValidArtifact(inputArtifact);

  const existing = readExistingArtifactFn(slug);
  const previousHistory = Array.isArray(existing?.diagnostics?.history)
    ? existing.diagnostics.history
    : [];
  const previousPatches = Array.isArray(existing?.patches) ? existing.patches : [];
  const iteration = Number(existing?.diagnostics?.iteration || 0) + 1;

  const baseHtml = typeof inputArtifact.html === "string" ? inputArtifact.html : "";
  const envelope = resolveHtmlEnvelope(baseHtml);
  const baseFragment = envelope.fragment;
  const currentFragment = applyPatchPlan(baseFragment, previousPatches);
  const currentHtml = envelope.apply(currentFragment);

  reporter.succeed(IMPROVE.EVALUATE_OFFENDERS);
  let evaluationBefore = evaluateFn({ slug, html: currentHtml, artifact: inputArtifact });
  const requireVisualDiff =
    process.env.IMPROVE_REQUIRE_VISUAL_DIFF === "0"
      ? false
      : stageConfig.requireVisualDiff !== false;
  const warnings = [];
  const errors = [];
  let skippedReason = null;
  let skippedDetails = null;

  if (requireVisualDiff) {
    let missingBuckets = missingVisualBuckets(evaluationBefore?.metrics);
    const rootScoreState = missingPipelineScoreBuckets(
      slug,
      missingBuckets.length ? missingBuckets : VISUAL_BREAKPOINTS
    );
    const needsArtifactWrite = rootScoreState.missing.length > 0;
    if (missingBuckets.length || needsArtifactWrite) {
      const bucketsToRefresh = missingBuckets.length ? missingBuckets : rootScoreState.missing;
      try {
        const compareResult = await ensureVisualDiffFn({
          slug,
          html: currentHtml,
          buckets: bucketsToRefresh,
          stage: "improve",
        });
        if (compareResult?.ok) {
          const mode = String(compareResult?.mode || "unknown");
          const filesWritten = Array.isArray(compareResult?.filesWritten)
            ? compareResult.filesWritten
            : [];
          const outDir = String(compareResult?.outDir || "").trim();
          reporter.log(
            `Visual diff refreshed (${mode}).` +
              (outDir ? ` outDir=${outDir}` : "") +
              (filesWritten.length ? ` files=${filesWritten.slice(0, 6).join(" | ")}` : "")
          );
        }
        if (!compareResult || compareResult.ok === false) {
          const detail =
            compareResult?.error ||
            compareResult?.body?.error ||
            `compare failed${compareResult?.status ? ` (status ${compareResult.status})` : ""}`;
          const requestUrl = String(compareResult?.requestUrl || "").trim();
          const bodyPaths = compareResult?.body?.files ? JSON.stringify(compareResult.body.files) : "";
          warnings.push({
            message:
              `Visual diff refresh failed: ${detail}.` +
              (requestUrl ? ` request=${requestUrl}.` : "") +
              (bodyPaths ? ` files=${bodyPaths}.` : "") +
              (Array.isArray(compareResult?.warnings) && compareResult.warnings.length
                ? ` localWarnings=${compareResult.warnings.join(" | ")}.`
                : ""),
          });
        }
      } catch (error) {
        warnings.push({
          message: `Visual diff refresh failed: ${error?.message || "unknown error"}.`,
        });
      }
      evaluationBefore = evaluateFn({ slug, html: currentHtml, artifact: inputArtifact });
      missingBuckets = missingVisualBuckets(evaluationBefore?.metrics);
      if (missingBuckets.length) {
        skippedReason = "no-visual-diff";
        skippedDetails = `Missing visual diff for bucket(s): ${missingBuckets.join(", ")}.`;
        warnings.push({
          message: `${skippedDetails} Iteration skipped; no patches generated.`,
        });
      }
      const rootScoreStateAfter = missingPipelineScoreBuckets(
        slug,
        missingBuckets.length ? missingBuckets : VISUAL_BREAKPOINTS
      );
      if (rootScoreStateAfter.missing.length) {
        warnings.push({
          message: `Visual diff artifacts still missing in ${rootScoreStateAfter.outDir} for bucket(s): ${rootScoreStateAfter.missing.join(", ")}.`,
        });
      }
    }
  }

  const offenders = Array.isArray(evaluationBefore?.metrics?.offenders)
    ? evaluationBefore.metrics.offenders
    : [];

  const maxOffendersRaw =
    process.env.IMPROVE_MAX_OFFENDERS ?? stageConfig.maxOffenders ?? 25;
  const maxOffenders = Math.max(1, Number(maxOffendersRaw) || 25);

  reporter.succeed(IMPROVE.SELECT_OFFENDERS);
  const topOffenders = offenders.slice(0, maxOffenders);
  reporter.log(`Selected offenders (${topOffenders.length}/${offenders.length}):`);
  if (!topOffenders.length) {
    reporter.log("- none");
  } else {
    topOffenders.slice(0, 20).forEach((offender) => {
      reporter.log(`- ${formatOffenderLine(offender)}`);
    });
  }

  reporter.succeed(IMPROVE.GENERATE_PLAN);
  const provider = selectPatchProvider(stageConfig, generatePatchPlanFn);
  const providerLabel = formatProviderLabel(provider.id);
  const planResult = provider.generate({
    html: currentFragment,
    offenders: skippedReason ? [] : topOffenders,
    nodeIndex: inputArtifact.nodeIndex,
    iteration,
    limit: maxOffenders,
  });
  if (skippedReason) {
    planResult.warnings = [
      ...(Array.isArray(planResult.warnings) ? planResult.warnings : []),
      `Skipped improve iteration (${skippedReason}): ${skippedDetails}`,
    ];
    planResult.skippedReason = skippedReason;
  }

  const planEntries = Array.isArray(planResult?.entries)
    ? planResult.entries
    : Array.isArray(planResult?.patches)
      ? planResult.patches.map((patch) => ({
          patch,
          ledgerEntries: [],
          seenOps: new Set(),
        }))
      : [];
  const strategyStats = normalizeStrategyStats(planResult?.strategyStats);
  reporter.log(
    `Patch strategy stats (${strategyStats.length || 0} ${
      strategyStats.length === 1 ? "strategy" : "strategies"
    }):`
  );
  if (!strategyStats.length) {
    reporter.log("- none");
  } else {
    strategyStats.forEach((row) => {
      reporter.log(
        `- ${row.name}: attempted=${row.attempted}, candidateOps=${row.candidateOps}`
      );
    });
  }
  const zeroCandidatesReason =
    planEntries.length === 0
      ? summarizeZeroCandidates({
          skippedReason,
          skippedDetails,
          topOffenders,
          providerId: provider.id,
          strategyStats,
        })
      : null;
  if (zeroCandidatesReason) {
    reporter.log(`Zero candidates reason: ${zeroCandidatesReason}`);
  }

  if (Array.isArray(planResult?.warnings) && planResult.warnings.length) {
    warnings.push(
      ...planResult.warnings.map((message) => ({
        message: String(message),
      }))
    );
  }

  const { nodeMap: guardNodeMap } = collectNodeMap(currentFragment);
  const guardContext = {
    nodeMap: guardNodeMap,
    isProtected: isProtectedMediaNode,
    canProveClipping,
    getMeasurements: () => ({}),
  };
  const { accepted: heightAccepted, rejectedWithReasons: heightRejected } =
    guardedHeightPatchFilter(planEntries, guardContext);

  const acceptedEntries = [];
  const rejectedEntries = [];

  heightRejected.forEach(({ entry, reason, nodeId }) => {
    rejectedEntries.push({
      patch: entry.patch,
      reason,
      nodeId,
    });
  });

  reporter.succeed(IMPROVE.VALIDATE_PLAN);
  heightAccepted.forEach((entry) => {
    const result = validatePatch(entry.patch);
    if (!result.valid) {
      const reason = String(result.reason || "").trim() || "Patch has no bounded ops.";
      rejectedEntries.push({ patch: entry.patch, reason });
      return;
    }
    const sanitizedPatch = result.patch;
    if (!sanitizedPatch.selector) {
      sanitizedPatch.selector = entry.patch.selector || "";
    }
    entry.ledgerEntries.forEach((ledgerEntry) => {
      ledgerEntry.nodeId = sanitizedPatch.nodeId;
      if (!ledgerEntry.selector) ledgerEntry.selector = sanitizedPatch.selector;
    });
    acceptedEntries.push({
      patch: sanitizedPatch,
      ledgerEntries: entry.ledgerEntries,
    });
  });

  reporter.succeed(IMPROVE.APPLY_PATCHES);
  const proposedEntries = [...acceptedEntries];
  const proposedPatches = proposedEntries.map((entry) => entry.patch);

  reporter.succeed(IMPROVE.EVALUATE_VERIFY);
  const gate = resolveGateConfig(stageConfig.gate);
  let acceptedByGateEntries = [];
  let rejectedByGate = [];
  let evaluationAfter = evaluationBefore;
  let workingFragment = currentFragment;
  let workingHtml = currentHtml;

  if (proposedEntries.length) {
    if (gate.enabled) {
      reporter.log(`Trial-gating ${proposedEntries.length} proposed patch(es) independently...`);
      for (const entry of proposedEntries) {
        const candidateFragment = applyPatchPlan(workingFragment, [entry.patch]);
        const candidateHtml = envelope.apply(candidateFragment);
        if (requireVisualDiff) {
          try {
            const refreshedAfter = await ensureVisualDiffFn({
              slug,
              html: candidateHtml,
              buckets: VISUAL_BREAKPOINTS,
              stage: "improve-verify",
              preferLocalHtml: true,
            });
            if (!refreshedAfter?.ok && refreshedAfter) {
              const detail =
                refreshedAfter?.error ||
                refreshedAfter?.body?.error ||
                `verify compare failed${refreshedAfter?.status ? ` (status ${refreshedAfter.status})` : ""}`;
              warnings.push({
                message: `Visual diff trial verify refresh failed for ${entry.patch?.nodeId || "unknown"}: ${detail}.`,
              });
            }
          } catch (error) {
            warnings.push({
              message: `Visual diff trial verify refresh failed for ${entry.patch?.nodeId || "unknown"}: ${error?.message || "unknown error"}.`,
            });
          }
        }
        const candidateEvaluation = evaluateFn({ slug, html: candidateHtml, artifact: inputArtifact });
        const gateResult = assessScoreGate(
          evaluationAfter?.metrics,
          candidateEvaluation?.metrics,
          gate
        );
        if (gateResult.accept) {
          acceptedByGateEntries.push(entry);
          workingFragment = candidateFragment;
          workingHtml = candidateHtml;
          evaluationAfter = candidateEvaluation;
          reporter.log(
            `Accepted patch ${entry.patch?.nodeId || "unknown"} (${gateResult.reason || "score improved"})`
          );
        } else {
          const reason = gateResult.reason || "Score gate rejected patch.";
          rejectedByGate.push({
            patch: entry.patch,
            reason,
          });
          reporter.log(`Rejected patch ${entry.patch?.nodeId || "unknown"} (${reason})`);
        }
      }
    } else {
      acceptedByGateEntries = [...proposedEntries];
      workingFragment = applyPatchPlan(currentFragment, proposedPatches);
      workingHtml = envelope.apply(workingFragment);
      if (requireVisualDiff) {
        try {
          const refreshedAfter = await ensureVisualDiffFn({
            slug,
            html: workingHtml,
            buckets: VISUAL_BREAKPOINTS,
            stage: "improve-verify",
            preferLocalHtml: true,
          });
          if (!refreshedAfter?.ok && refreshedAfter) {
            const detail =
              refreshedAfter?.error ||
              refreshedAfter?.body?.error ||
              `verify compare failed${refreshedAfter?.status ? ` (status ${refreshedAfter.status})` : ""}`;
            warnings.push({ message: `Visual diff verify refresh failed: ${detail}.` });
          }
        } catch (error) {
          warnings.push({
            message: `Visual diff verify refresh failed: ${error?.message || "unknown error"}.`,
          });
        }
      }
      evaluationAfter = evaluateFn({ slug, html: workingHtml, artifact: inputArtifact });
    }
  }

  rejectedEntries.push(...rejectedByGate);
  rejectedEntries.forEach((entry) => {
    warnings.push({
      message: `Rejected patch for ${entry.patch?.nodeId || entry.nodeId || "unknown"}: ${entry.reason || "unknown"}`,
    });
  });

  reporter.succeed(IMPROVE.ACCEPT_GATE);
  const acceptedPatches = acceptedByGateEntries.map((entry) => entry.patch);
  const gateAccepted = rejectedByGate.length === 0;
  const gateMessage = rejectedByGate.length
    ? [...new Set(rejectedByGate.map((item) => String(item.reason || "").trim()).filter(Boolean))]
        .join(" | ")
    : "";

  const finalEvaluation = evaluationAfter;
  const missingVisualDiff = Array.isArray(finalEvaluation?.diagnostics?.visualDiff?.missing)
    ? finalEvaluation.diagnostics.visualDiff.missing
    : [];
  missingVisualDiff.forEach((entry) => {
    const bp = String(entry?.breakpoint || "unknown");
    const reason = String(entry?.reason || "missing-visual-diff");
    const scorePaths = Array.isArray(entry?.searched?.scoreFiles) ? entry.searched.scoreFiles : [];
    const figmaPaths = Array.isArray(entry?.searched?.figmaFiles) ? entry.searched.figmaFiles : [];
    const renderPaths = Array.isArray(entry?.searched?.renderFiles) ? entry.searched.renderFiles : [];
    const parseError = entry?.parseError ? ` parseError=${entry.parseError}` : "";
    warnings.push({
      message:
        `Evaluate visual diff missing for ${bp}: reason=${reason}.` +
        ` scorePaths=${scorePaths.slice(0, 3).join(" | ") || "none"}` +
        ` figmaPaths=${figmaPaths.slice(0, 2).join(" | ") || "none"}` +
        ` renderPaths=${renderPaths.slice(0, 2).join(" | ") || "none"}` +
        parseError,
    });
  });
  const finalPatches = [...previousPatches, ...acceptedPatches];
  const ledgerEntries = acceptedByGateEntries.flatMap((entry) => entry.ledgerEntries);

  const patchesProposed = planEntries.length;
  const patchesAccepted = acceptedByGateEntries.length;
  const patchesRejected = rejectedEntries.length;
  const gateRejected = rejectedByGate.length > 0;

  const rejectionReasonGroups = [];
  const reasonToEntries = new Map();
  rejectedEntries.forEach((entry) => {
    const r = String(entry?.reason || "unknown").trim();
    if (!reasonToEntries.has(r)) reasonToEntries.set(r, []);
    reasonToEntries.get(r).push(entry);
  });
  reasonToEntries.forEach((entries, reason) => {
    const nodeIds = [...new Set(entries.map((e) => e.patch?.nodeId || e.nodeId).filter(Boolean))];
    rejectionReasonGroups.push({ reason, count: entries.length, nodeIds });
  });

  reporter.succeed(IMPROVE.WRITE_ARTIFACT);

  const deltas = buildDeltas(evaluationBefore?.metrics, finalEvaluation?.metrics);
  const baseDiagnostics = isPlainObject(inputArtifact.diagnostics)
    ? inputArtifact.diagnostics
    : {};

  const patchPlanSummary = {
    offendersFound: offenders.length,
    selectedOffenders: topOffenders.length,
    generated: planEntries.length,
    accepted: patchesAccepted,
    rejected: patchesRejected,
    provider: provider.id,
    gateAccepted,
    gateMessage: gateMessage || undefined,
    skippedReason: skippedReason || undefined,
    skippedDetails: skippedDetails || undefined,
    strategyStats,
    zeroCandidatesReason: zeroCandidatesReason || undefined,
  };

  const historyEntry = {
    iteration,
    createdAt: new Date().toISOString(),
    inputHash: hashInput(inputArtifact),
    proposedPatches,
    acceptedByGate: acceptedPatches,
    rejectedByGate,
    acceptedPatches,
    rejectedPatches: rejectedEntries,
    scoreBefore: evaluationBefore?.metrics || {},
    scoreAfter: finalEvaluation?.metrics || {},
    patchPlan: patchPlanSummary,
    skippedReason: skippedReason || undefined,
    skippedDetails: skippedDetails || undefined,
  };

  const artifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "improve",
    createdAt: new Date().toISOString(),
    html: baseHtml,
    patches: finalPatches,
    assets: isPlainObject(inputArtifact.assets) ? inputArtifact.assets : {},
    diagnostics: {
      ...baseDiagnostics,
      iteration,
      provider: provider.id,
      warnings,
      errors,
      ledger: ledgerEntries,
      patchPlan: {
        offendersFound: offenders.length,
        selectedOffenders: topOffenders.length,
        generated: planEntries.length,
        accepted: acceptedByGateEntries.length,
        rejected: rejectedEntries.length,
        provider: provider.id,
        gateAccepted,
        gateMessage: gateMessage || undefined,
        skippedReason: skippedReason || undefined,
        skippedDetails: skippedDetails || undefined,
        strategyStats,
        zeroCandidatesReason: zeroCandidatesReason || undefined,
      },
      improveSummary: `Offenders: ${offenders.length} | Proposed: ${patchesProposed} | Accepted: ${patchesAccepted} | Rejected: ${patchesRejected} | Provider: ${provider.id}`,
      offendersFoundButRejected:
        offenders.length > 0 && patchesAccepted === 0,
      offendersFoundButGateRejected: gateRejected,
      noOffendersFound: offenders.length === 0,
      rejectionReasonGroups,
      planDiagnostics: Array.isArray(planResult?.diagnostics) ? planResult.diagnostics : [],
      history: [...previousHistory, historyEntry],
    },
    metrics: (() => {
      const base = isPlainObject(finalEvaluation?.metrics) ? finalEvaluation.metrics : {};
      const fallbackScore = buildFallbackScore(base);
      return {
        ...base,
        deltas,
        iteration,
        fallbackScore,
      };
    })(),
  };

  if (isPlainObject(inputArtifact.nodeIndex)) {
    artifact.nodeIndex = inputArtifact.nodeIndex;
  }

  assertValidArtifact(artifact);
  writeArtifactFn(slug, artifact);
  if (typeof writeHistorySnapshotFn === "function") {
    writeHistorySnapshotFn(slug, iteration, historyEntry);
  }

  reporter.succeed(IMPROVE.DONE);

  const noOffendersMessage = offenders.length === 0 ? "No offenders found." : undefined;
  const noPatchesAcceptedMessage =
    offenders.length > 0 && patchesAccepted === 0
      ? gateRejected
        ? "Offenders found but rejected by score gate."
        : "Offenders found but no patches accepted (validation or guards)."
      : undefined;

  reporter.writeImproveSummary({
    offendersFound: offenders.length,
    patchesProposed,
    patchesAccepted,
    patchesRejected,
    rejectionReasonGroups,
    providerLabel,
    noOffendersMessage,
    noPatchesAcceptedMessage,
  });

  const fixGroups = summarizeLedger(ledgerEntries).sort((a, b) => b.count - a.count);
  const fallbackScoreVal = buildFallbackScore(finalEvaluation?.metrics);
  const fallbackReasons = Array.isArray(finalEvaluation?.diagnostics?.visualDiff?.missing)
    ? finalEvaluation.diagnostics.visualDiff.missing
        .map((entry) => `${entry.breakpoint}:${entry.reason}`)
        .filter(Boolean)
    : [];
  if (
    typeof finalEvaluation?.metrics?.breakpoints?.desktop?.visual?.pixelDiffRatio?.value !== "number"
  ) {
    reporter.log(
      `Fallback score in use (${fallbackScoreVal}).` +
        (fallbackReasons.length ? ` reasons=${fallbackReasons.join(", ")}` : "")
    );
  }
  const scorePerBreakpoint = {};
  ["mobile", "tablet", "desktop"].forEach((bp) => {
    const score = finalEvaluation?.metrics?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    const delta = deltas?.[bp]?.visual?.pixelDiffRatio?.delta;
    scorePerBreakpoint[bp] =
      typeof score === "number"
        ? `${formatRatio(score)} (delta ${formatDelta(delta)})`
        : "—";
  });

  reporter.writeSummary({
    errors,
    warnings,
    fixCount: ledgerEntries.length,
    fixGroups,
    formatFixLine: (group) => formatFixLine(group),
    artifactsPath: getArtifactPath(slug),
    scorePerBreakpoint,
    fallbackScore:
      typeof finalEvaluation?.metrics?.breakpoints?.desktop?.visual?.pixelDiffRatio?.value !== "number"
        ? fallbackScoreVal
        : undefined,
  });

  return artifact;
};

module.exports = {
  run,
};
