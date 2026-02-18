"use strict";

const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
  setAttrValue,
} = require("../utils/html");

const id = "media/videoFillSupport";

const VIDEO_MARKERS = ["data-bg-type", "data-fill-type", "data-media"];
const VIDEO_MARKER_VALUE = "video";

function isVideoLike(node) {
  if (!node?.attrs) return false;
  for (const key of VIDEO_MARKERS) {
    const v = getAttrValue(node.attrs, key);
    if (String(v || "").trim().toLowerCase() === VIDEO_MARKER_VALUE) return true;
  }
  return false;
}

function hasRelativeClass(attrs) {
  const tokens = getClassTokens(attrs || {});
  return tokens.some((t) => String(t).split(":").pop() === "relative");
}

function ensureRelative(attrs, order) {
  if (hasRelativeClass(attrs)) return;
  const tokens = getClassTokens(attrs);
  if (!tokens.includes("relative")) {
    setClassTokens(attrs, order, [...tokens, "relative"]);
  }
}

function stripBackgroundImageStyle(attrs, order) {
  const style = String(getAttrValue(attrs, "style") || "").trim();
  if (!style) return;
  const cleaned = style
    .replace(/\s*background-image\s*:\s*[^;]+;?/gi, "")
    .replace(/\s*background-size\s*:\s*[^;]+;?/gi, "")
    .replace(/\s*background-position\s*:\s*[^;]+;?/gi, "")
    .replace(/\s*background-repeat\s*:\s*[^;]+;?/gi, "")
    .trim()
    .replace(/;\s*;+/g, ";")
    .replace(/^\s*;\s*|\s*;\s*$/g, "");
  if (cleaned === "" || !cleaned) {
    const idx = order.indexOf("style");
    if (idx >= 0) {
      delete attrs.style;
      order.splice(idx, 1);
    }
  } else {
    setAttrValue(attrs, order, "style", cleaned);
  }
}

function escapeAttr(val) {
  return String(val || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Already has our injected video/placeholder as first child (idempotency). */
function alreadyHasVideoOrPlaceholder(html, openEnd, closeStart) {
  const inner = html.slice(openEnd, closeStart).replace(/^[\s\n]+|[\s\n]+$/g, "");
  return (
    /^\s*<video\s/i.test(inner) ||
    (/^\s*<div\s/i.test(inner) && /absolute\s+inset-0|object-cover/.test(inner))
  );
}

/**
 * Deterministic video fill support: nodes with data-bg-type="video" | data-fill-type="video" | data-media="video".
 * If data-video-url: render <video>; else placeholder (poster or neutral block). Preserve layout with relative + z-10 content.
 */
const apply = ({ html }) => {
  const source = String(html ?? "");
  if (!source) {
    return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };
  }

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  let adjusted = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node?.attrs) continue;
    if (!isVideoLike(node)) continue;
    if (node.isSelfClosing) continue;
    if (node.closeStart == null || node.closeEnd == null) continue;

    const openEnd = node.openEnd;
    const closeStart = node.closeStart;
    const innerContent = source.slice(openEnd, closeStart);

    if (alreadyHasVideoOrPlaceholder(source, openEnd, closeStart)) continue;

    const videoUrl = (getAttrValue(node.attrs, "data-video-url") || getAttrValue(node.attrs, "data-src") || "").trim();
    const posterUrl = (getAttrValue(node.attrs, "data-poster-url") || "").trim();

    ensureRelative(node.attrs, node.attrOrder);
    stripBackgroundImageStyle(node.attrs, node.attrOrder);

    let mediaBlock;
    if (videoUrl) {
      const posterAttr = posterUrl ? ` poster="${escapeAttr(posterUrl)}"` : "";
      mediaBlock =
        `<video autoplay muted loop playsinline class="absolute inset-0 w-full h-full object-cover" src="${escapeAttr(videoUrl)}"${posterAttr}></video>`;
    } else {
      if (posterUrl) {
        mediaBlock =
          `<div class="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat" style="background-image: url('${escapeAttr(posterUrl).replace(/'/g, "&#39;")}');"></div>`;
      } else {
        mediaBlock = `<div class="absolute inset-0 w-full h-full bg-[#1a1a1a]"></div>`;
      }
    }

    const wrappedContent =
      mediaBlock + "\n" + '<div class="relative z-10">' + innerContent + "\n</div>";

    patches.push(createPatch(openEnd, closeStart, wrappedContent));
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, false)
      )
    );

    changes.push({
      contractId: id,
      nodeId: getAttrValue(node.attrs, "data-key") || getAttrValue(node.attrs, "data-node-id") || node.tag,
      op: "videoFill",
      reason: videoUrl ? "Video fill: inserted <video> and content wrapper" : "Video fill: inserted placeholder and content wrapper",
    });
    adjusted += 1;
  }

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
