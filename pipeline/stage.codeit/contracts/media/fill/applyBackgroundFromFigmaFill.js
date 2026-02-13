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
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "media/fill/applyBackgroundFromFigmaFill";

const BG_INTENT_TOKENS = new Set(["bg-cover", "bg-center", "bg-no-repeat"]);
const BG_ARBITRARY = /^bg-\[[^\]]+\]$/;
const BG_URL_ARBITRARY = /^bg-\[.*url\(.+\).*\]$/i;
const HEIGHT_INTENT = /^(h-|min-h-)/;

const normalizeToken = (token) => String(token || "").split(":").pop();

const escapeAttr = (value) =>
  String(value || "")
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isDecorative = (node) => getAttrValue(node?.attrs, "data-decorative") === "1";

const hasBackgroundIntent = (tokens) => {
  return tokens.some((t) => {
    const core = normalizeToken(t);
    if (BG_INTENT_TOKENS.has(core)) return true;
    return BG_ARBITRARY.test(core);
  });
};

const hasBgUrlClass = (tokens) =>
  tokens.some((t) => BG_URL_ARBITRARY.test(normalizeToken(t)));

const hasBackgroundImageStyle = (styleValue) =>
  /background-image\s*:/i.test(String(styleValue || ""));

const hasBgDataAttrs = (attrs) => {
  if (!attrs) return false;
  return Object.keys(attrs).some((key) => {
    const k = String(key || "").trim();
    if (!k) return false;
    if (k === "data-fill-type" || k === "data-media") return true;
    return k.startsWith("data-bg-");
  });
};

const hasHeightIntent = (tokens, attrs) => {
  if (tokens.some((t) => HEIGHT_INTENT.test(normalizeToken(t)))) return true;
  const hIntent = String(getAttrValue(attrs, "data-h-intent") || "").trim();
  if (hIntent === "fixed") return true;
  const dataKey = String(getAttrValue(attrs, "data-key") || "");
  if (/hero/i.test(dataKey) || dataKey === "root") return true;
  return false;
};

const isHeroLike = (tokens, attrs) => {
  const hasCover = tokens.some((t) => {
    const core = normalizeToken(t);
    return core === "bg-cover" || core === "bg-center";
  });
  if (!hasCover) return false;
  return hasHeightIntent(tokens, attrs);
};

const escapeCssUrl = (value) => String(value || "").replace(/'/g, "&#39;");

const appendBackgroundImageStyle = (attrs, order, url) => {
  const escaped = escapeCssUrl(url);
  const existing = String(getAttrValue(attrs, "style") || "").trim();
  const suffix = existing && !existing.endsWith(";") ? ";" : "";
  const next = `${existing}${suffix} background-image: url('${escaped}');`.trim();
  setAttrValue(attrs, order, "style", next);
};

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

const pickFillCandidate = (fills) => {
  const list = Array.isArray(fills) ? fills : [];
  const video = list.find(isVideoFill);
  if (video) return { kind: "video", fill: video };
  const image = list.find(isImageFill);
  if (image) return { kind: "image", fill: image };
  return null;
};

const pickImageSrc = (fill) => {
  if (!fill) return "";
  const candidates = [
    fill?.src,
    fill?.image?.src,
    fill?.imageSrc,
    fill?.asset?.src,
    fill?.file?.src,
    fill?.url,
  ]
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => String(s).trim());
  return candidates[0] || "";
};

const pickVideoAsset = (fill, node) => {
  const srcCandidates = [
    fill?.src,
    fill?.url,
    fill?.video?.src,
    fill?.asset?.src,
    fill?.file?.src,
    node?.video?.src,
  ]
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => String(s).trim());
  const posterCandidates = [
    fill?.poster,
    fill?.posterUrl,
    fill?.poster?.src,
    node?.poster,
    node?.posterUrl,
  ]
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => String(s).trim());
  return { src: srcCandidates[0] || "", poster: posterCandidates[0] || "" };
};

const guessVideoMime = (url) => {
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".ogv") || clean.endsWith(".ogg")) return "video/ogg";
  if (clean.endsWith(".mp4") || clean.endsWith(".m4v")) return "video/mp4";
  return "video/mp4";
};

const alreadyInjectedVideoLayer = (html, openEnd, closeStart) => {
  const inner = html.slice(openEnd, closeStart);
  if (!inner) return false;
  if (/<video[\s>]/i.test(inner) && /absolute\s+inset-0/.test(inner)) return true;
  if (/<div[^>]*class="[^"]*relative\s+z-10/i.test(inner) && /<video[\s>]/i.test(inner)) {
    return true;
  }
  return false;
};

const ensureContainerClasses = (attrs, order) => {
  const tokens = getClassTokens(attrs);
  const hasRelative = tokens.some((t) => normalizeToken(t) === "relative");
  const hasOverflowHidden = tokens.some((t) => normalizeToken(t) === "overflow-hidden");
  if (hasRelative && hasOverflowHidden) return tokens;
  const next = [...tokens];
  if (!hasRelative) next.push("relative");
  if (!hasOverflowHidden) next.push("overflow-hidden");
  setClassTokens(attrs, order, next);
  return next;
};

const apply = ({ html, artifact }) => {
  const source = String(html ?? "");
  if (!source) {
    return {
      html: source,
      changes: [],
      warnings: [],
      stats: { adjusted: 0, wrapped: 0 },
    };
  }

  const figmaAst = resolveFigmaAst(artifact);
  const figmaRoot = figmaAst?.tree || figmaAst;
  const figmaNodeMap = figmaRoot ? buildFigmaNodeMap(figmaRoot) : new Map();

  if (!figmaNodeMap.size) {
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0, wrapped: 0 } };
  }

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  let adjusted = 0;
  let wrapped = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (isMediaTag(node.tag)) return;
    if (isDecorative(node)) return;

    const tokens = getClassTokens(node.attrs);
    if (!hasBackgroundIntent(tokens)) return;
    if (hasBgUrlClass(tokens)) return;
    if (hasBackgroundImageStyle(getAttrValue(node.attrs, "style"))) return;
    if (hasBgDataAttrs(node.attrs)) return;

    const nodeId = String(getAttrValue(node.attrs, "data-node-id") || "").trim();
    if (!nodeId) return;
    const figmaNode = figmaNodeMap.get(nodeId);
    if (!figmaNode) return;

    const fillCandidate = pickFillCandidate(getFills(figmaNode));
    if (!fillCandidate) return;

    if (fillCandidate.kind === "image") {
      const src = pickImageSrc(fillCandidate.fill);
      if (!src) return;
      appendBackgroundImageStyle(node.attrs, node.attrOrder, src);
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
        op: "backgroundImage",
        value: src,
        reason: "Applied IMAGE fill background to node with bg intent",
      });
      adjusted += 1;
      return;
    }

    if (fillCandidate.kind === "video") {
      const { src, poster } = pickVideoAsset(fillCandidate.fill, figmaNode);
      const canLayer = Boolean(src) && isHeroLike(tokens, node.attrs);
      if (canLayer) {
        if (node.isSelfClosing || node.closeStart == null || node.closeEnd == null) return;
        if (alreadyInjectedVideoLayer(source, node.openEnd, node.closeStart)) return;

        ensureContainerClasses(node.attrs, node.attrOrder);
        patches.push(
          createPatch(
            node.openStart,
            node.openEnd,
            buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
          )
        );

        const mime = guessVideoMime(src);
        const posterAttr = poster ? ` poster="${escapeAttr(poster)}"` : "";
        const videoBlock =
          `<video class="absolute inset-0 w-full h-full object-cover" autoplay muted loop playsinline preload="metadata"${posterAttr}>` +
          `<source src="${escapeAttr(src)}" type="${escapeAttr(mime)}">` +
          `</video>`;

        const innerContent = source.slice(node.openEnd, node.closeStart);
        const wrappedContent =
          videoBlock +
          "\n" +
          '<div class="relative z-10">' +
          innerContent +
          "\n</div>";
        patches.push(createPatch(node.openEnd, node.closeStart, wrappedContent));

        const meta = getNodeMeta(node);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "videoBackground",
          value: src,
          reason: "Applied VIDEO fill with background layer",
        });
        adjusted += 1;
        wrapped += 1;
        return;
      }

      if (poster) {
        appendBackgroundImageStyle(node.attrs, node.attrOrder, poster);
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
          op: "backgroundPoster",
          value: poster,
          reason: "Applied VIDEO poster background when layering not safe",
        });
        adjusted += 1;
      }
    }
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings: [],
    stats: { adjusted, wrapped },
  };
};

module.exports = {
  id,
  apply,
};
