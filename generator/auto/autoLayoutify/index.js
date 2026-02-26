// generator/auto/autoLayoutify/autoLayoutify.js
// DOM-first converter: AST -> Tailwind HTML section
//
// Goals:
// - Pixel-faithful preview without rasterizing everything
// - Prefer Grid over Flex where applicable (but NEVER for vertical stacks)
// - No fixed heights except <img> and fixed CTA instances
// - No self-stretch
// - Accessible semantics (buttons/links), focus ring via `.btn`
// - Optional outer wrapper (wrap=true by default)
// - Section background: full-bleed wrapper with layered bg support (real fill image when available)
//
// IMPORTANT TYPOGRAPHY RULE (Preview/Ready-for-export):
// - DO NOT emit inline font-family styles.
// - Emit Tailwind classes only.
// - Font mapping is project-specific: pass opts.fontMap = { "Montserrat": "font-primary", ... }.
// - If no mapping exists for a family, fallback to Tailwind arbitrary font class: font-['Family'].
// - Use high precision for typography rem values to avoid drift (e.g. 0.0625rem must stay exact).

import { rem } from "./precision.js";
import { escAttr } from "./escape.js";
import { detectSectionBackground } from "./background.js";
import { renderNode } from "./render.js";

console.log("🔥 autoLayoutify LOADED FROM:", import.meta.url);

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
  process.exit(1);
});

/* ================== PUBLIC API ================== */

function isHeroSection(ast) {
  const rootName = String(ast?.tree?.name || "").toLowerCase();
  const frameName = String(ast?.meta?.figma?.frameName || "").toLowerCase();
  const sectionType = String(ast?.meta?.intentGraph?.sectionType || "").toLowerCase();
  const matchedType = String(ast?.meta?.componentMatch?.type || "").toLowerCase();
  return (
    rootName.includes("hero") ||
    frameName.includes("hero") ||
    sectionType === "hero" ||
    matchedType === "hero"
  );
}

function toMinHeroMobileHeightRem(rootHeightPx) {
  const hPx = Number(rootHeightPx);
  if (!Number.isFinite(hPx) || hPx <= 0) return "18.75";
  const scaled = hPx / 2.6 / 16;
  const clamped = Math.max(18.75, Math.min(32, scaled));
  return Number(clamped.toFixed(4)).toString().replace(/\.?0+$/, "");
}

function parseRemWidth(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return 0;
  const rem = value.match(/^(\d+(?:\.\d+)?)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const px = value.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  const num = value.match(/^(\d+(?:\.\d+)?)$/);
  if (num) return Number(num[1]);
  return 0;
}

function inferContentRootWidthPx(tree) {
  const frameW = Number(tree?.w || 0);
  const children = Array.isArray(tree?.children) ? tree.children : [];
  if (!children.length) return 0;

  const rootLike = children.find((c) => String(c?.key || "").toLowerCase() === "root");
  if (rootLike) {
    const explicitRem = parseRemWidth(rootLike?.attrs?.["data-w-rem"]);
    const explicitNodeRem = parseRemWidth(rootLike?.["data-w-rem"]);
    const byMeta = explicitRem || explicitNodeRem;
    if (Number.isFinite(byMeta) && byMeta > 0) return byMeta;
    const byWidth = Number(rootLike?.w || 0);
    if (Number.isFinite(byWidth) && byWidth > 0) return byWidth;
  }

  const widths = children
    .map((c) => Number(c?.w || 0))
    .filter((w) => Number.isFinite(w) && w > 0);
  if (!widths.length) return 0;
  if (frameW > 0 && widths.length >= 2) {
    const maxChild = Math.max(...widths);
    const hasWideChild = widths.some((w) => w >= frameW * 0.45);
    const hasNarrowSibling = widths.some((w) => w <= frameW * 0.35);
    if (maxChild < frameW * 0.75 && hasWideChild && hasNarrowSibling) {
      return frameW;
    }
  }
  const narrower = widths.filter((w) => frameW > 0 && w < frameW);
  return narrower.length ? Math.max(...narrower) : Math.max(...widths);
}

export function autoLayoutify(ast, opts = {}) {
  const semantics = opts.semantics || {}; // { [id]: { tag, href?, role?, label? } }
  const wrap = opts.wrap !== false; // default true

  // Project-specific font mapping. Example:
  // opts.fontMap = { "Montserrat": "font-primary", "Red Hat Display": "font-secondary" }
  // If not provided, we fallback to font-['Family'] classes.
  const fontMap = opts.fontMap || {};

  if (!ast?.tree) throw new Error("autoLayoutify: missing tree");

  // Detect section bg (REAL when available, placeholder as fallback).
  // IMPORTANT: we do NOT suppress the root node render; we only suppress background CHILD layers.
  const bgInfo = detectSectionBackground(ast.tree, ast);
  const suppressBgIds = new Set(bgInfo?.suppressChildIds || []);

  // If we do NOT have linked mobile/tablet variants, apply a small responsive fallback so
  // desktop paddings don't dominate smaller viewports.
  const responsiveVariants = Array.isArray(ast?.meta?.responsive?.variants)
    ? ast.meta.responsive.variants
    : [];
  const isMergedGroup = !!ast?.meta?.responsive?.mergedGroup || responsiveVariants.length >= 2;
  const responsiveFallback = !isMergedGroup ? { maxXlPx: "max-xl:px-5" } : null;

  const html = renderNode(ast.tree, null, true, semantics, {
    suppressBgIds,
    suppressRootBgId: bgInfo?.suppressRootBgId || null,
    fontMap,
    responsiveFallback,
  });

  if (!wrap) return html;

  // Required outer section (full bleed bg when present, or video fill markers for codeit)
  const rootClips = !!ast?.tree?.clipsContent;
  const overflowClass = rootClips ? " max-md:overflow-visible overflow-hidden" : "";
  let sectionOpen;
  const heroSection = isHeroSection(ast);
  if (bgInfo?.kind === "video" && heroSection) {
    const videoUrl = escAttr(bgInfo.videoUrl || "");
    const posterUrl = escAttr(bgInfo.posterUrl || "");
    sectionOpen = `<section class="relative flex overflow-hidden bg-center bg-no-repeat bg-cover" data-bg-type="video" data-video-url="${videoUrl}" data-poster-url="${posterUrl}" data-bg-video-desktop="${videoUrl}" data-bg-video-mobile="${videoUrl}">`;
  } else if (bgInfo?.kind === "video") {
    const videoUrl = escAttr(bgInfo.videoUrl || "");
    const posterUrl = escAttr(bgInfo.posterUrl || "");
    sectionOpen = `<section class="relative flex${overflowClass}" data-bg-type="video" data-video-url="${videoUrl}" data-poster-url="${posterUrl}">`;
  } else {
    const bgSize = String(bgInfo?.size || "cover");
    const bgPos = String(bgInfo?.position || "center");
    const bgRepeat = String(bgInfo?.repeat || "no-repeat");
    const bgBlend = String(bgInfo?.blendMode || "").trim();
    const blendDecl = bgBlend ? ` background-blend-mode: ${bgBlend};` : "";
    const sectionStyle = bgInfo?.css
      ? ` style="background-image: ${bgInfo.css}; background-size: ${bgSize}; background-position: ${bgPos}; background-repeat: ${bgRepeat};${blendDecl}"`
      : "";
    sectionOpen = `<section class="relative flex${overflowClass}"${sectionStyle}>`;
  }

  // Content container:
  // Use max-width based on the root Figma frame width (NOT max-w-container).
  const modeledMaxWidth = Number(ast?.tree?.__layoutModel?.containerIntent?.maxWidth || 0);
  const inferredContentWidth = inferContentRootWidthPx(ast?.tree || null);
  const effectiveModeledWidth =
    Number.isFinite(modeledMaxWidth) && modeledMaxWidth > 0 ? modeledMaxWidth : 0;
  const effectiveInferredWidth =
    Number.isFinite(inferredContentWidth) && inferredContentWidth > 0
      ? inferredContentWidth
      : 0;
  const preferredWidth =
    effectiveInferredWidth &&
    (!effectiveModeledWidth || effectiveModeledWidth > effectiveInferredWidth)
      ? effectiveInferredWidth
      : effectiveModeledWidth;
  const rootW = Math.max(1, Math.round(preferredWidth || ast?.tree?.w || ast?.frame?.w || 1200));
  const maxWClass = `max-w-[${rem(rootW)}]`;

  const innerOpen = `<div class="relative z-20 w-full ${maxWClass} mx-auto">`;
  if (bgInfo?.kind === "video" && heroSection) {
    const videoUrl = escAttr(bgInfo.videoUrl || "");
    const posterUrl = escAttr(bgInfo.posterUrl || "");
    const posterAttr = posterUrl ? ` poster="${posterUrl}"` : "";
    const mobileMinH = toMinHeroMobileHeightRem(ast?.tree?.h);
    const desktopLayer =
      `<div class="hidden md:block absolute inset-0" aria-hidden="true">` +
      `<video autoplay muted loop playsinline class="object-cover absolute inset-0 w-full h-full"${posterAttr}>` +
      `<source src="${videoUrl}" type="video/mp4">` +
      `</video></div>`;
    const mobileLayer =
      `<div class="relative z-20 w-full md:hidden">` +
      `<video autoplay muted loop playsinline class="object-cover w-full h-full min-h-[${mobileMinH}rem]"${posterAttr}>` +
      `<source src="${videoUrl}" type="video/mp4">` +
      `</video></div>`;
    return (
      sectionOpen +
      "\n" +
      desktopLayer +
      "\n" +
      mobileLayer +
      "\n" +
      innerOpen +
      "\n" +
      html +
      "\n</div>\n</section>"
    );
  }
  const innerOpenDefault = `<div class="w-full ${maxWClass}">`;
  return sectionOpen + "\n" + innerOpenDefault + "\n" + html + "\n</div>\n</section>";
}
