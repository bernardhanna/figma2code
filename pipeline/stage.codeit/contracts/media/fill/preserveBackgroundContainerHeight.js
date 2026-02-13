"use strict";

const fs = require("fs");
const path = require("path");

const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "media/fill/preserveBackgroundContainerHeight";

const BG_INTENT_TOKENS = new Set(["bg-cover", "bg-center", "bg-no-repeat"]);
const BG_ARBITRARY = /^bg-\[[^\]]+\]$/;
const HEIGHT_TOKEN = /^(min-h|h)-\[/;
const MIN_HEIGHT_PX = 48;

const normalizeToken = (token) => String(token || "").split(":").pop();

const isDecorative = (node) => getAttrValue(node?.attrs, "data-decorative") === "1";

const hasBackgroundIntent = (tokens) => {
  return tokens.some((t) => {
    const core = normalizeToken(t);
    if (BG_INTENT_TOKENS.has(core)) return true;
    return BG_ARBITRARY.test(core);
  });
};

const hasBackgroundImageStyle = (styleValue) =>
  /background-image\s*:/i.test(String(styleValue || ""));

const resolveFigmaAst = (artifact) => {
  if (artifact?.ast && typeof artifact.ast === "object") return artifact.ast;
  if (artifact?.meta?.ast && typeof artifact.meta.ast === "object") return artifact.meta.ast;
  if (artifact?.meta?.tree && typeof artifact.meta.tree === "object") {
    return { tree: artifact.meta.tree };
  }
  const slug = String(artifact?.slug || "").trim();
  if (!slug) return null;
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
  const stagingPath = path.join(
    repoRoot,
    "generator",
    ".preview",
    "staging",
    "staging",
    `${slug}.json`
  );
  if (!fs.existsSync(stagingPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(stagingPath, "utf8"));
    if (raw?.ast && typeof raw.ast === "object") return raw.ast;
    if (raw?.tree && typeof raw.tree === "object") return { tree: raw.tree };
    return null;
  } catch {
    return null;
  }
};

const buildFigmaNodeMap = (root) => {
  const map = new Map();
  if (!root) return map;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node.id) map.set(String(node.id), node);
    const kids = Array.isArray(node.children) ? node.children : [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return map;
};

const getFills = (node) => {
  if (Array.isArray(node?.fills)) return node.fills;
  if (Array.isArray(node?.fill)) return node.fill;
  return [];
};

const isVideoFill = (fill) => {
  if (!fill) return false;
  if (String(fill?.kind || "").toLowerCase() === "video") return true;
  const type = String(fill?.type || fill?.fillType || "").toUpperCase();
  return type === "VIDEO";
};

const isImageFill = (fill) => {
  if (!fill) return false;
  if (String(fill?.kind || "").toLowerCase() === "image") return true;
  const type = String(fill?.type || fill?.fillType || "").toUpperCase();
  return type === "IMAGE";
};

const hasImageOrVideoFill = (node) => {
  const fills = getFills(node);
  return fills.some((f) => isImageFill(f) || isVideoFill(f));
};

const getHeightIntent = (node) => {
  const layout = String(node?.auto?.layout || "").toUpperCase();
  if (layout === "VERTICAL") {
    return String(node?.auto?.primarySizing || node?.size?.primary || "");
  }
  if (layout === "HORIZONTAL") {
    return String(node?.auto?.counterSizing || node?.size?.counter || "");
  }
  return String(node?.size?.primary || node?.size?.counter || "");
};

const isHeightFixed = (node) => String(getHeightIntent(node) || "").toUpperCase() === "FIXED";

const resolveHeightPx = (node) => {
  if (typeof node?.size?.h === "number") return node.size.h;
  if (typeof node?.h === "number") return node.h;
  if (typeof node?.bb?.h === "number") return node.bb.h;
  return null;
};

const toRem = (px) => {
  const value = Math.round((px / 16) * 10000) / 10000;
  const fixed = value.toFixed(4);
  return fixed.replace(/\.?0+$/, "");
};

const hasMdHeightToken = (tokens) =>
  tokens.some((t) => /^md:(min-h|h)-\[/.test(String(t || "")));

const shouldStripHeightToken = (token) => {
  const parts = String(token || "").split(":");
  const core = parts.pop();
  if (!HEIGHT_TOKEN.test(core)) return false;
  if (parts.length === 0) return true;
  const prefix = parts[0];
  if (prefix === "md" || prefix === "lg" || prefix === "xl" || prefix === "2xl") return false;
  return true;
};

const hasMinHeightToken = (tokens) =>
  tokens.some((t) => /^min-h-\[/.test(normalizeToken(t)));

const apply = ({ html, artifact }) => {
  const source = String(html ?? "");
  if (!source) {
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };
  }

  const figmaAst = resolveFigmaAst(artifact);
  const figmaRoot = figmaAst?.tree || figmaAst;
  const figmaNodeMap = figmaRoot ? buildFigmaNodeMap(figmaRoot) : new Map();
  if (!figmaNodeMap.size) {
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };
  }

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  let adjusted = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    if (isMediaTag(node.tag)) return;
    if (isDecorative(node)) return;

    const tokens = getClassTokens(node.attrs);
    if (!hasBackgroundIntent(tokens)) return;

    const hasBgStyle = hasBackgroundImageStyle(getAttrValue(node.attrs, "style"));
    const nodeId = String(getAttrValue(node.attrs, "data-node-id") || "").trim();
    if (!nodeId) return;
    const figmaNode = figmaNodeMap.get(nodeId);
    if (!figmaNode) return;
    if (!hasBgStyle && !hasImageOrVideoFill(figmaNode)) return;
    if (!isHeightFixed(figmaNode)) return;

    const heightPx = resolveHeightPx(figmaNode);
    if (!heightPx || heightPx < MIN_HEIGHT_PX) return;
    if (hasMdHeightToken(tokens)) return;

    const cleaned = tokens.filter((t) => !shouldStripHeightToken(t));
    if (!cleaned.some((t) => normalizeToken(t) === "h-auto")) {
      cleaned.push("h-auto");
    }

    const prefersMin = hasMinHeightToken(tokens);
    const mdToken = prefersMin
      ? `md:min-h-[${toRem(heightPx)}rem]`
      : `md:h-[${toRem(heightPx)}rem]`;
    if (!cleaned.includes(mdToken)) cleaned.push(mdToken);

    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );

    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "heightPreserve",
      value: mdToken,
      reason: "Background media container preserves fixed desktop height",
    });
    adjusted += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings: [],
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};
