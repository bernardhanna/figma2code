// generator/auto/autoLayoutify/render.js
//
// Renders normalized AST nodes into Tailwind HTML.
// Notes:
// - Background child suppression is handled via ctx.suppressBgIds
// - CTA rendering supports <a>/<button> + inner label/span + optional SVG children
// - SVG leaf rendering happens before text/button/img fallbacks
// - IMPORTANT: layoutGridFlex import is declared ONCE (fixes "already been declared")

import { cls, num, pos, rem, remTypo, spacingClass } from "./precision.js";
import { escAttr } from "./escape.js";
import { twFontClassForFamily } from "./fonts.js";

import {
  aiTagFor,
  aiHrefFor,
  aiLabelFor,
  chooseTextTag,
  shouldRenderAsLinkOrButton,
} from "./semantics.js";

import {
  shouldUseGrid,
  gridColsFor,
  gridColsResponsive,
  flexResponsiveClasses,
} from "./layoutGridFlex.js";

import {
  paddings,
  childSizing,
  alignSelf,
  sizeClassForLeaf,
  sizeClassForImg,
  fixedBoxSize,
  resolveAxisIntents,
} from "./sizing.js";

import { boxDeco, hasOwnBoxDeco, hasUnsupportedBlur } from "./styles.js";
import { refineCtaClasses } from "./ctaRefine.js";

import { resolveCtaInnerHtml, resolveCtaLabel } from "./ctaLabel.js";
import { renderSvgLeaf } from "./svgRender.js";
import { isCtaNode } from "./interactiveRules.js";

/* ------------------ tag helpers ------------------ */

function openTag(tag, classes = "", attrs = "", node, ctx) {
  const nodeId = node?.id ? ` data-node-id="${escAttr(node.id)}"` : "";

  const injectedFromCtx =
    node?.id && ctx?.classInject && typeof ctx.classInject.get === "function"
      ? String(ctx.classInject.get(node.id) || "")
      : "";

  const injectedFromNode = node?.tw ? String(node.tw) : "";

  const finalClasses = cls(classes, injectedFromNode, injectedFromCtx);

  return `<${tag}${nodeId}${attrs}${finalClasses ? ` class="${finalClasses}"` : ""}>`;
}

function attrsFromMap(attrs) {
  if (!attrs || typeof attrs !== "object") return "";
  return Object.entries(attrs)
    .map(([k, v]) => {
      const key = String(k || "").trim();
      if (!key) return "";
      if (v === false || v === null || typeof v === "undefined") return "";
      if (v === true) return ` ${escAttr(key)}`;
      return ` ${escAttr(key)}="${escAttr(String(v))}"`;
    })
    .filter(Boolean)
    .join("");
}

function normalizeIntent(raw) {
  const intent = String(raw || "").toUpperCase();
  if (intent === "FILL" || intent === "FIXED" || intent === "HUG") return intent.toLowerCase();
  return "";
}

function heightIntentRawFromNode(node, parentLayout) {
  const parent = String(parentLayout || "").toUpperCase();

  // IMPORTANT:
  // In a GRID context, do NOT infer height intent from "counter" like a flex row.
  // Grid children generally should be treated as HUG unless they *explicitly* opt into fixed/fill
  // via their own auto layout. The heights contract will then strip wrapper heights.
  if (parent === "GRID") {
    const autoLayout = String(node?.auto?.layout || "").toUpperCase();
    if (autoLayout === "VERTICAL") return node?.auto?.primarySizing;
    if (autoLayout === "HORIZONTAL") return node?.auto?.counterSizing;
    return ""; // default -> hug
  }

  // If the PARENT is a flex direction, use child sizing relative to that axis.
  if (node?.size && (parent === "HORIZONTAL" || parent === "VERTICAL")) {
    return parent === "VERTICAL" ? node.size.primary : node.size.counter;
  }

  // Otherwise fall back to the node’s own auto layout intent.
  const autoLayout = String(node?.auto?.layout || "").toUpperCase();
  if (autoLayout === "VERTICAL") return node?.auto?.primarySizing;
  if (autoLayout === "HORIZONTAL") return node?.auto?.counterSizing;

  return node?.auto?.counterSizing || node?.auto?.primarySizing || "";
}

function attrsForNode(node, extra = "", parentLayout = null) {
  const dn = node?.id ? ` data-node="${escAttr(node.id)}"` : "";
  const dk = node?.key ? ` data-key="${escAttr(node.key)}"` : "";

  const axisIntents = resolveAxisIntents(node, parentLayout);
  const widthIntentValue = normalizeIntent(axisIntents.widthIntent);
  const widthIntent = widthIntentValue
    ? ` data-w-intent="${widthIntentValue}"`
    : "";

  const rawHeightIntent = heightIntentRawFromNode(node, parentLayout);
  let heightIntentValue = normalizeIntent(rawHeightIntent);

  // ----------------------------
  // Guard: DO NOT mark non-media wrappers as fixed height.
  // If it's a container (has children), and it's not media/hero/root/decorative/button,
  // treat fixed-height intent as "hug" so the heights contract can strip wrapper h-[...].
  // ----------------------------
  const nameLower = String(node?.name || "").toLowerCase();
  const keyLower = String(node?.key || "").toLowerCase();
  const tag = String(node?.tag || "").toLowerCase();

  const hasChildren =
    Array.isArray(node?.children) && node.children.length > 0;

  const isRoot = keyLower === "root";
  const isHero = nameLower.includes("hero") || keyLower.includes("hero");
  const isDecorative =
    nameLower.includes("decorativebar") ||
    nameLower.includes("divider") ||
    keyLower.includes("decorativebar") ||
    keyLower.includes("divider");

  const isButtonLike =
    tag === "button" ||
    (typeof node?.tw === "string" && node.tw.split(/\s+/g).includes("btn")) ||
    (Array.isArray(node?.className) && node.className.includes("btn"));

  // Media-ish detection (match the contract’s idea of media)
  const isImgTag = tag === "img";
  const isMediaish =
    isImgTag ||
    nameLower.includes("image") ||
    nameLower.includes("img") ||
    nameLower.includes("cover") ||
    keyLower.includes("image") ||
    keyLower.includes("img") ||
    keyLower.includes("cover");

  // Coerce fixed -> hug for non-media containers
  if (
    heightIntentValue === "fixed" &&
    hasChildren &&
    !isMediaish &&
    !isRoot &&
    !isHero &&
    !isDecorative &&
    !isButtonLike
  ) {
    heightIntentValue = "hug";
  }

  const heightIntent = heightIntentValue
    ? ` data-h-intent="${heightIntentValue}"`
    : "";

  const widthPx = num(node?.size?.w)
    ? node.size.w
    : num(node?.w)
      ? node.w
      : null;
  const widthRem = widthPx ? ` data-w-rem="${escAttr(rem(widthPx))}"` : "";

  const decorativeAttr = isDecorative ? ` data-decorative="1"` : "";
  const maskInfo = maskInfoFromNode(node);
  const rawCustom =
    node?.attrs && typeof node.attrs === "object"
      ? node.attrs
      : node?.dataAttrs && typeof node.dataAttrs === "object"
        ? node.dataAttrs
        : null;
  const customAttrs = rawCustom ? { ...rawCustom } : {};
  if (maskInfo?.kind === "svg-path") {
    const existingStyle = String(customAttrs.style || "").trim();
    const delim = existingStyle && !existingStyle.endsWith(";") ? ";" : "";
    const pathCss = escapeCssPathLiteral(maskInfo.path);
    customAttrs.style = `${existingStyle}${delim} clip-path: path('${pathCss}'); -webkit-clip-path: path('${pathCss}');`.trim();
    if (!customAttrs["data-mask-type"]) customAttrs["data-mask-type"] = "svg";
  } else if (maskInfo?.kind === "raster-fallback") {
    if (!customAttrs["data-mask-fallback"]) customAttrs["data-mask-fallback"] = "rasterize";
  }
  const cornerSmoothing = Number(node?.cornerSmoothing);
  if (Number.isFinite(cornerSmoothing) && cornerSmoothing > 0.001) {
    if (!customAttrs["data-corner-smoothing"]) {
      customAttrs["data-corner-smoothing"] = String(Number(cornerSmoothing.toFixed(4)));
    }
    if (!customAttrs["data-corner-smoothing-fallback"]) {
      // CSS border-radius cannot faithfully reproduce Figma corner smoothing.
      customAttrs["data-corner-smoothing-fallback"] = "rasterize";
    }
  }
  if (hasUnsupportedBlur(node) && !customAttrs["data-blur-fallback"]) {
    customAttrs["data-blur-fallback"] = "rasterize";
  }
  const custom = attrsFromMap(customAttrs);

  return (
    dn +
    dk +
    widthIntent +
    heightIntent +
    widthRem +
    decorativeAttr +
    custom +
    (extra || "")
  );
}



/* ------------------ CTA text helpers ------------------ */

function collectTextNodesDeep(node, out = [], seen = new Set()) {
  if (!node || seen.has(node)) return out;
  seen.add(node);
  if (node.text && typeof node.text.raw === "string" && node.text.raw.trim()) {
    out.push(node);
  }
  for (const c of node.children || []) collectTextNodesDeep(c, out, seen);
  return out;
}

function clamp01(x) {
  const n = Number(x);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rgba01ToCss(rgba) {
  if (!rgba) return "";
  const r01 = rgba.r,
    g01 = rgba.g,
    b01 = rgba.b;
  if (typeof r01 !== "number" || typeof g01 !== "number" || typeof b01 !== "number")
    return "";

  const r = Math.round(clamp01(r01) * 255);
  const g = Math.round(clamp01(g01) * 255);
  const b = Math.round(clamp01(b01) * 255);

  const a = typeof rgba.a === "number" ? clamp01(rgba.a) : 1;
  return `rgba(${r},${g},${b},${a})`;
}

function remPx(px) {
  const n = Number(px);
  if (!isFinite(n) || n <= 0) return "";
  const v = (n / 16).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${v}rem`;
}

function escapeCssPathLiteral(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function maskInfoFromNode(node) {
  const mask = node?.mask || {};
  const path = [
    node?.maskPath,
    node?.clipPath,
    mask?.path,
    mask?.svgPath,
    mask?.clipPath,
  ].find((s) => typeof s === "string" && s.trim());
  if (path) return { kind: "svg-path", path: String(path).trim() };

  const maskType = String(node?.maskType || mask?.type || "").trim();
  const maskLike = !!(node?.isMask || mask?.enabled === true || maskType);
  if (maskLike && !node?.clipsContent) return { kind: "raster-fallback" };
  return null;
}

function nodeBox(node) {
  if (!node || typeof node !== "object") return null;
  const bb = node.bb || node.bbox || null;
  if (bb) {
    const x = Number(bb.x), y = Number(bb.y), w = Number(bb.w), h = Number(bb.h);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const x = Number(node.x), y = Number(node.y), w = Number(node.w), h = Number(node.h);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { x, y, w, h };
  }
  return null;
}

function shouldUseAbsoluteFallback(node, children, ctx) {
  if (!node || !Array.isArray(children) || children.length < 2) return null;
  const al = String(node?.auto?.layout || "").toUpperCase();
  if (al && al !== "NONE") return null; // explicit auto-layout should not fallback here.
  const hints = node?.__layoutHints || {};
  if (!hints.lowConfidence && !hints.fallbackRecommended) return null;
  if (hints.collectionLike) return null;

  const parent = nodeBox(node);
  if (!parent) return null;

  const entries = [];
  for (const child of children) {
    const cb = nodeBox(child);
    if (!cb || !child?.id) return null;
    const left = cb.x - parent.x;
    const top = cb.y - parent.y;
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    if (left < -8 || top < -8) return null;
    entries.push({ childId: child.id, left, top, w: cb.w, h: cb.h });
  }

  const cap = Number.isFinite(Number(ctx?.absoluteFallbackMaxNodes))
    ? Math.max(0, Number(ctx.absoluteFallbackMaxNodes))
    : 6;
  const used = Number.isFinite(Number(ctx?.__absFallbackUsed)) ? Number(ctx.__absFallbackUsed) : 0;
  if (entries.length > cap || used + entries.length > cap) return null;

  return { parent, entries };
}

function normalizeConstraintValue(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return "";
  return v.replace(/\s+/g, "_").replace(/-/g, "_");
}

function readConstraintAxis(node, axis) {
  const c = node?.constraints || node?.constraint || {};
  if (axis === "horizontal") {
    return (
      c.horizontal ??
      c.x ??
      c.h ??
      c.horizontalConstraint ??
      c.constraintX ??
      ""
    );
  }
  return c.vertical ?? c.y ?? c.v ?? c.verticalConstraint ?? c.constraintY ?? "";
}

function hasExplicitWidthToken(node) {
  const tokens = String(node?.tw || node?.className || "")
    .split(/\s+/g)
    .filter(Boolean);
  return tokens.some((t) => /^(?:\w+:)?(?:w-|max-w-|basis-)/.test(t));
}

function constraintClassesForNonAutoChild(node) {
  const horizontal = normalizeConstraintValue(readConstraintAxis(node, "horizontal"));
  if (!horizontal) return "";

  if (horizontal === "LEFT_RIGHT" || horizontal === "LEFTANDRIGHT" || horizontal === "SCALE" || horizontal === "STRETCH" || horizontal === "BOTH") {
    if (hasExplicitWidthToken(node)) return "";
    return "w-full max-w-full";
  }
  if (horizontal === "CENTER") return "mx-auto";
  if (horizontal === "RIGHT") return "ml-auto";
  return "";
}

function fixedSizeClassesForCta(node) {
  const w = typeof node?.w === "number" ? node.w : null;
  const h = typeof node?.h === "number" ? node.h : null;

  if (!w || !h) return "";

  const isFixed =
    node?.size?.primary === "FIXED" ||
    node?.size?.counter === "FIXED" ||
    node?.auto?.primarySizing === "FIXED" ||
    node?.auto?.counterSizing === "FIXED";

  if (!isFixed) return "";

  return cls(`lg:w-[${remPx(w)}]`, `lg:h-[${remPx(h)}]`, "lg:min-h-0");
}

function typographyClassesFromRecovered(node, ctx) {
  if (!node) return "";

  const t = node?.cta?.typography || null;

  const run0 =
    Array.isArray(node?.__instanceText) && node.__instanceText.length
      ? node.__instanceText[0]
      : null;

  const family = String(t?.family || run0?.family || "").trim();
  const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap) : "";

  const fontSizePx =
    typeof t?.sizePx === "number"
      ? t.sizePx
      : typeof run0?.fontSize === "number"
        ? run0.fontSize
        : null;

  const lineHeightPx =
    typeof t?.lineHeightPx === "number"
      ? t.lineHeightPx
      : typeof run0?.lineHeightPx === "number"
        ? run0.lineHeightPx
        : null;

  const letterSpacingPx =
    typeof t?.letterSpacingPx === "number"
      ? t.letterSpacingPx
      : typeof run0?.letterSpacingPx === "number"
        ? run0.letterSpacingPx
        : 0;

  const weight =
    typeof t?.weight === "number"
      ? t.weight
      : typeof run0?.fontWeight === "number"
        ? run0.fontWeight
        : null;

  const fs = fontSizePx ? `text-[${remTypo(fontSizePx)}]` : "";
  const lh =
    typeof lineHeightPx === "number" && lineHeightPx > 0
      ? `leading-[${remTypo(lineHeightPx)}]`
      : "";

  const ls =
    typeof letterSpacingPx === "number" && letterSpacingPx !== 0
      ? `tracking-[${remTypo(letterSpacingPx)}]`
      : "";

  const fw = weight ? `font-[${weight}]` : "";

  const ital = t?.italic === true || run0?.italic === true ? "italic" : "";
  const tt = t?.uppercase === true || run0?.uppercase === true ? "uppercase" : "";

  const decoText =
    (t?.decoration || run0?.decoration) === "underline"
      ? "underline"
      : (t?.decoration || run0?.decoration) === "line-through"
        ? "line-through"
        : "";

  const rgbaCss = rgba01ToCss(run0?.color || null);
  const color = rgbaCss ? `text-[${rgbaCss}]` : "";

  return cls(ffClass, fs, lh, ls, fw, color, ital, decoText, tt);
}

function typographyClassesFromTextNode(textNode, ctx) {
  if (!textNode) return "";

  const t = textNode.text || {};
  const typo = textNode.typography || {};

  const family = String(
    typo.family || t.fontFamily || t.family || t.fontName?.family || ""
  ).trim();
  const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap) : "";

  const fontSizePx = typeof typo.sizePx === "number" ? typo.sizePx : t.fontSize;
  const lineHeightPx =
    typeof typo.lineHeightPx === "number"
      ? typo.lineHeightPx
      : typeof t.lineHeightPx === "number"
        ? t.lineHeightPx
        : null;

  const letterSpacingPx =
    typeof typo.letterSpacingPx === "number"
      ? typo.letterSpacingPx
      : typeof t.letterSpacingPx === "number"
        ? t.letterSpacingPx
        : 0;

  const fs = fontSizePx ? `text-[${remTypo(fontSizePx)}]` : "";
  const lh =
    typeof lineHeightPx === "number" && lineHeightPx > 0
      ? `leading-[${remTypo(lineHeightPx)}]`
      : "";
  const ls =
    typeof letterSpacingPx === "number" && letterSpacingPx !== 0
      ? `tracking-[${remTypo(letterSpacingPx)}]`
      : "";

  const weight = typeof typo.weight === "number" ? typo.weight : t.fontWeight;
  const fw = weight ? `font-[${weight}]` : "";

  const hex = String(typo.colorHex || t.colorHex || t.fillHex || "").trim();
  const color = hex ? `text-[${hex}]` : "";

  const ital = t.italic ? "italic" : "";
  const tt = t.uppercase ? "uppercase" : "";
  const decoText =
    t.decoration === "underline"
      ? "underline"
      : t.decoration === "line-through"
        ? "line-through"
        : "";

  return cls(ffClass, fs, lh, ls, fw, color, ital, decoText, tt);
}

function bestCtaLabel(node, semantics) {
  const texts = collectTextNodesDeep(node, []);
  const fromText = (texts[0]?.text?.raw || "").trim();
  if (fromText) return fromText;

  const fromResolver = (resolveCtaLabel(node, semantics) || "").trim();
  if (fromResolver) return fromResolver;

  const fromAI = (aiLabelFor(node, semantics) || "").trim();
  if (fromAI) return fromAI;

  return "";
}

/* ================== CORE RENDER ================== */

export function renderNode(node, parentLayout, isRoot, semantics, ctx = {}) {
  if (!isRoot && ctx?.suppressBgIds?.has(node.id)) return "";

  const stack = ctx.__renderStack || new Set();
  ctx.__renderStack = stack;
  if (stack.has(node)) return "";
  stack.add(node);

  const hintedAxis = String(node?.__layoutHints?.axis || "").toLowerCase();
  const isAuto =
    (node.auto && node.auto.layout && node.auto.layout !== "NONE") ||
    ((hintedAxis === "horizontal" || hintedAxis === "vertical") &&
      Array.isArray(node?.children) &&
      node.children.length > 1);
  const out = isAuto
    ? renderAuto(node, isRoot, semantics, parentLayout, ctx)
    : renderLeaf(node, parentLayout, isRoot, semantics, ctx);

  stack.delete(node);
  return out;
}

/* ------------------ auto container ------------------ */

function renderAuto(node, isRoot, semantics, parentLayout, ctx) {
  const rawAuto = node.auto || {};
  const hintAxis = String(node?.__layoutHints?.axis || "").toLowerCase();
  const inferredLayout =
    rawAuto.layout && rawAuto.layout !== "NONE"
      ? rawAuto.layout
      : hintAxis === "horizontal"
        ? "HORIZONTAL"
        : "VERTICAL";
  const inferredSpacing =
    Number.isFinite(Number(rawAuto.itemSpacing))
      ? Number(rawAuto.itemSpacing)
      : Number(node?.__layoutHints?.spacingPx || 0);
  const al = {
    ...rawAuto,
    layout: inferredLayout,
    itemSpacing: inferredSpacing,
    primaryAlign: rawAuto.primaryAlign || "MIN",
    counterAlign: rawAuto.counterAlign || "MIN",
  };
  const children =
    (Array.isArray(node.children) && node.children.length
      ? node.children
      : node?.__states?.default?.children) || [];
  const nodeForLayout =
    children === node.children ? node : { ...node, children };

  const gap = pos(al.itemSpacing) ? spacingClass("gap", al.itemSpacing) : "";
  const heroLike =
    /\bhero\b/i.test(String(node?.name || "")) ||
    /\bhero\b/i.test(String(node?.key || "")) ||
    String(node?.attrs?.role || "").toLowerCase() === "banner";
  const pad = paddings(al, {
    isHero: heroLike,
    onWarning: (msg) => {
      if (!ctx.__warnings) ctx.__warnings = [];
      ctx.__warnings.push(String(msg));
      // Keep visible in logs for deterministic debugging of spacing outliers.
      if (typeof console !== "undefined" && console.warn) console.warn(`[autoLayoutify] ${msg}`);
    },
  });
  const fallbackPx =
    isRoot &&
    ctx?.responsiveFallback?.maxXlPx &&
    (pos(al?.padL) || pos(al?.padR))
      ? String(ctx.responsiveFallback.maxXlPx)
      : "";

  const omitBg = isRoot && ctx?.suppressRootBgId === node.id;

  const decoBase = boxDeco(node, /*isText=*/ false, /*omitBg=*/ omitBg);
  const deco = cls(decoBase);
  const clip = node.clipsContent ? "overflow-hidden" : "";

  const useGrid = shouldUseGrid(nodeForLayout, semantics);
  const nameLower = String(node?.name || "").toLowerCase();
  const isDecorativeBar =
    nameLower.includes("decorativebar") ||
    (nameLower.includes("decorative") && nameLower.includes("bar"));

  const layoutClasses = useGrid
    ? gridColsResponsive(gridColsFor(nodeForLayout))
    : flexResponsiveClasses(al, children, {
        forceRow: isDecorativeBar && al.layout === "HORIZONTAL",
        noWrap: isDecorativeBar,
      });

  let tag =
    aiTagFor(node, semantics) || shouldRenderAsLinkOrButton(node) || "div";

  // SAFETY: never render auto-layout containers as interactive unless they have explicit actions
  const hasChildren = Array.isArray(children) && children.length > 0;
  const hasActions = !!(node?.actions?.openUrl || node?.actions?.isClickable === true);

  if (hasChildren && (tag === "a" || tag === "button") && !hasActions) {
    tag = "div";
  }

  const containerOk = new Set([
    "div",
    "section",
    "nav",
    "header",
    "footer",
    "a",
    "button",
    "select",
  ]);
  if (!containerOk.has(tag)) tag = "div";

  const hrefFromAI = aiHrefFor(node, semantics);

  const isButtonTag = tag === "button";
  const isLinkTag = tag === "a";
  const isButtonLikeLink = isLinkTag && (node.actions?.openUrl || hrefFromAI);

  const hasCtaMeta = !!node.cta;
  const isCtaInteractive = hasCtaMeta && (isButtonTag || isButtonLikeLink);

  const refined = hasCtaMeta ? refineCtaClasses(node) : null;

  const ctaFixed = hasCtaMeta ? fixedSizeClassesForCta(node) : "";

  const ctaBase = hasCtaMeta
    ? cls(
      "btn",
      "inline-flex justify-center items-center gap-2",
      "whitespace-nowrap",
      "hover:opacity-90 transition-opacity duration-200",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
      refined?.pad || "",
      refined?.minH || "",
      ctaFixed
    )
    : "";

  const fixedSize = fixedBoxSize(node, /*allowH=*/ true);
  const container = cls(layoutClasses, gap, pad, fallbackPx, deco, clip, ctaBase, fixedSize);

  const pieces = children
    .map((child) => {
      if (ctx?.suppressBgIds?.has(child.id)) return null;

      const sizing = childSizing(child, useGrid ? "GRID" : al.layout);
      const self = alignSelf(child);

      // Instead of wrapping in a <div>, inject these onto the child's own root element.
      if ((sizing || self) && child?.id) {
        if (!ctx.classInject) ctx.classInject = new Map();
        const prev = String(ctx.classInject.get(child.id) || "");
        ctx.classInject.set(child.id, cls(prev, sizing, self));
      }

      return renderNode(child, useGrid ? "GRID" : al.layout, false, semantics, ctx);
    })
    .filter(Boolean)
    .join("\n");

  const hrefAttr = isLinkTag
    ? ` href="${escAttr(hrefFromAI || node.actions?.openUrl || "#")}"`
    : "";
  const typeAttr = isButtonTag ? ` type="button"` : "";

  const label = hasCtaMeta
    ? bestCtaLabel(node, semantics)
    : (aiLabelFor(node, semantics) || "").trim();

  const aria =
    isCtaInteractive && label ? ` aria-label="${escAttr(label)}"` : "";

  let body = pieces;

  if (hasCtaMeta) {
    if (!body || !String(body).trim()) {
      const recoveredTypo = typographyClassesFromRecovered(node, ctx);
      const texts = collectTextNodesDeep(node, []);
      const descendantTypo = typographyClassesFromTextNode(texts[0], ctx);

      const typoCls = recoveredTypo || descendantTypo;
      const safeLabel = label || "";

      body = safeLabel
        ? `<span${typoCls ? ` class="${escAttr(typoCls)}"` : ""}>${escAttr(
          safeLabel
        )}</span>`
        : "";
    }
  } else {
    body = body || "";
  }

  return (
    openTag(
      tag,
      container,
      attrsForNode(node, hrefAttr + typeAttr + aria, parentLayout),
      node,
      ctx
    ) +
    body +
    `</${tag}>`
  );
}

/* ------------------ leaf ------------------ */

function optionLabelFromNode(node) {
  const raw =
    node?.option?.label ||
    node?.option?.text ||
    node?.text?.raw ||
    node?.name ||
    "";
  return String(raw || "").trim();
}

function optionValueFromNode(node, fallbackLabel) {
  const v = node?.option?.value;
  if (v === null || typeof v === "undefined") return fallbackLabel || "";
  return String(v);
}

function renderOptionsFromList(options) {
  if (!Array.isArray(options)) return "";
  return options
    .map((opt) => {
      const label = String(opt?.label || opt?.text || opt || "").trim();
      if (!label && label !== "") return "";
      const value =
        opt && typeof opt === "object" && "value" in opt ? String(opt.value ?? "") : label;
      const selected = opt?.selected ? " selected" : "";
      const disabled = opt?.disabled ? " disabled" : "";
      return `<option value="${escAttr(value)}"${selected}${disabled}>${escAttr(
        label
      )}</option>`;
    })
    .filter(Boolean)
    .join("");
}

function renderLeaf(node, parentLayout, isRoot, semantics, ctx) {
  const svg = renderSvgLeaf(node);
  if (svg) return svg;

  const isText = !!node.text;

  const aiLeafTag = aiTagFor(node, semantics);
  const aiLeafHref = aiHrefFor(node, semantics);
  const aiLeafLabel = aiLabelFor(node, semantics);

  if (aiLeafTag === "option") {
    const label = optionLabelFromNode(node);
    const value = optionValueFromNode(node, label);
    const selected = node?.option?.selected ? " selected" : "";
    const disabled = node?.option?.disabled ? " disabled" : "";
    const attrs = attrsForNode(
      node,
      ` value="${escAttr(value)}"${selected}${disabled}`,
      parentLayout
    );
    return openTag("option", "", attrs, node, ctx) + escAttr(label) + `</option>`;
  }

  if (aiLeafTag === "select") {
    const deco = boxDeco(node, /*isText=*/ false, /*omitBg=*/ false);
    const clip = node.clipsContent ? "overflow-hidden" : "";
    const baseSize = sizeClassForLeaf(node, parentLayout, isRoot, false);
    const classes = cls(baseSize, deco, clip);
    const optionsHtml = Array.isArray(node?.__options) && node.__options.length
      ? renderOptionsFromList(node.__options)
      : (node.children || [])
          .map((c) => renderNode(c, parentLayout, false, semantics, ctx))
          .join("\n");
    return (
      openTag("select", classes, attrsForNode(node, "", parentLayout), node, ctx) +
      optionsHtml +
      `</select>`
    );
  }

  if (isText) {
    const deco = boxDeco(node, /*isText=*/ true, /*omitBg=*/ true);
    const clip = node.clipsContent ? "overflow-hidden" : "";
    const baseSize = sizeClassForLeaf(node, parentLayout, isRoot, true);

    const t = node.text;
    const tag =
      aiLeafTag && ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span"].includes(aiLeafTag)
        ? aiLeafTag
        : chooseTextTag(node);

    const aligns = { left: "text-left", center: "text-center", right: "text-right" };
    const ta = aligns[t.align || "left"];

    const typo = node.typography || {};

    const rawText = String(t.raw || "");
    const needsPreserveWhitespace = rawText.includes("\n") || / {2,}/.test(rawText);
    const whitespaceClass = needsPreserveWhitespace ? "whitespace-pre-wrap" : "";

    const family = String(
      typo.family || t.fontFamily || t.family || t.fontName?.family || ""
    ).trim();
    const ffData = family ? ` data-ff="${escAttr(family)}"` : "";
    const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap) : "";

    const fontSizePx = typeof typo.sizePx === "number" ? typo.sizePx : t.fontSize;
    const lineHeightPx =
      typeof typo.lineHeightPx === "number"
        ? typo.lineHeightPx
        : typeof t.lineHeightPx === "number"
          ? t.lineHeightPx
          : null;

    const letterSpacingPx =
      typeof typo.letterSpacingPx === "number"
        ? typo.letterSpacingPx
        : typeof t.letterSpacingPx === "number"
          ? t.letterSpacingPx
          : 0;

    const fs = fontSizePx ? `text-[${remTypo(fontSizePx)}]` : "";
    const lh =
      typeof lineHeightPx === "number" && lineHeightPx > 0
        ? `leading-[${remTypo(lineHeightPx)}]`
        : "";

    const ls =
      typeof letterSpacingPx === "number" && letterSpacingPx !== 0
        ? `tracking-[${remTypo(letterSpacingPx)}]`
        : "";

    const weight = typeof typo.weight === "number" ? typo.weight : t.fontWeight;
    const fw = weight ? `font-[${weight}]` : "";

    const hex = String(typo.colorHex || t.colorHex || t.fillHex || "").trim();
    const color = hex ? `text-[${hex}]` : "";

    const ital = t.italic ? "italic" : "";
    const tt = t.uppercase ? "uppercase" : "";
    const decoText =
      t.decoration === "underline"
        ? "underline"
        : t.decoration === "line-through"
          ? "line-through"
          : "";

    const classes = cls(
      baseSize,
      deco,
      clip,
      whitespaceClass,
      "break-words",
      ta,
      fs,
      fw,
      lh,
      ls,
      color,
      ffClass,
      ital,
      decoText,
      tt
    );

    return (
      openTag(tag, classes, attrsForNode(node, ffData, parentLayout), node, ctx) +
      (t.raw || "") +
      `</${tag}>`
    );
  }

  const forced =
    aiLeafTag === "a" || aiLeafTag === "button" ? aiLeafTag : shouldRenderAsLinkOrButton(node);

  if (forced === "a" || forced === "button") {
    const deco = boxDeco(node, /*isText=*/ false, /*omitBg=*/ false);
    const clip = node.clipsContent ? "overflow-hidden" : "";
    const baseSize = sizeClassForLeaf(node, parentLayout, isRoot, false);

    const refined = refineCtaClasses(node);

    const href = aiLeafHref || node.actions?.openUrl || "";
    const isLink = forced === "a" || !!href;
    const tag = isLink ? "a" : "button";

    const recoveredLabel = (node?.cta?.label || "").trim();
    const label = recoveredLabel || resolveCtaLabel(node, semantics) || "";
    const aria = label ? ` aria-label="${escAttr(label)}"` : "";

    let inner = resolveCtaInnerHtml(node, semantics, (c) =>
      renderNode(c, parentLayout, false, semantics, ctx)
    );

    if (!inner || !String(inner).trim()) {
      const t = node?.cta?.typography || null;

      const family = String(t?.family || "").trim();
      const ffData = family ? ` data-ff="${escAttr(family)}"` : "";
      const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap) : "";

      const fs = typeof t?.sizePx === "number" ? `text-[${remTypo(t.sizePx)}]` : "";
      const lh =
        typeof t?.lineHeightPx === "number" && t.lineHeightPx > 0
          ? `leading-[${remTypo(t.lineHeightPx)}]`
          : "";
      const ls =
        typeof t?.letterSpacingPx === "number" && t.letterSpacingPx !== 0
          ? `tracking-[${remTypo(t.letterSpacingPx)}]`
          : "";

      const fw = typeof t?.weight === "number" ? `font-[${t.weight}]` : "";
      const ital = t?.italic ? "italic" : "";
      const tt = t?.uppercase ? "uppercase" : "";
      const decoText =
        t?.decoration === "underline"
          ? "underline"
          : t?.decoration === "line-through"
            ? "line-through"
            : "";

      const colorHex = typeof t?.colorHex === "string" ? t.colorHex.trim() : "";
      const color = colorHex ? `text-[${colorHex}]` : "";

      const spanClasses = cls(
        "relative",
        fs,
        lh,
        ls,
        fw,
        color,
        ffClass,
        ital,
        decoText,
        tt
      );

      inner =
        `<span${ffData}${spanClasses ? ` class="${spanClasses}"` : ""}>` +
        escAttr(label || "") +
        `</span>`;
    }

    const classes = cls(
      baseSize,
      deco,
      clip,
      "flex gap-2 justify-center items-center",
      "w-fit whitespace-nowrap max-sm:w-full",
      refined?.pad || "",
      refined?.minH || "",
      "btn hover:opacity-90 transition-opacity duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    );

    const hrefAttr = isLink ? ` href="${escAttr(href || "#")}"` : "";
    const typeAttr = tag === "button" ? ` type="button"` : "";
    const targetAttr =
      isLink && typeof node?.actions?.target === "string" && node.actions.target.trim()
        ? ` target="${escAttr(node.actions.target)}"`
        : "";

    return (
      openTag(
        tag,
        classes,
        attrsForNode(node, hrefAttr + targetAttr + typeAttr + aria, parentLayout),
        node,
        ctx
      ) +
      inner +
      `</${tag}>`
    );
  }

  if (node.img?.src) {
    const deco = boxDeco(node, /*isText=*/ false, /*omitBg=*/ true);
    const clip = node.clipsContent ? "overflow-hidden" : "";
    const sizeForImg = sizeClassForImg(node, parentLayout);
    const classes = cls(sizeForImg, deco, clip, "object-cover");

    const alt = escAttr(node.name || "Image");

    // IMPORTANT: injected sizing classes should apply to <img> too, so we use openTag.
    const booleanRasterFallback =
      String(node?.type || "").toUpperCase() === "BOOLEAN_OPERATION"
        ? ` data-boolean-op="raster-fallback"`
        : "";
    return (
      openTag(
        "img",
        classes,
        ` src="${escAttr(node.img.src)}" alt="${alt}" loading="lazy" decoding="async"${booleanRasterFallback}`,
        node,
        ctx
      ).replace(/>$/, " />") // make it self-closing
    );
  }

  const deco = boxDeco(node, /*isText=*/ false, /*omitBg=*/ false);
  const clip = node.clipsContent ? "overflow-hidden" : "";
  const baseSize = sizeClassForLeaf(node, parentLayout, isRoot, false);

  const inner = (node.children || [])
    .map((c) => {
      // Basic non-auto constraints interpreter for child anchoring.
      const constraintCls = constraintClassesForNonAutoChild(c);
      if (constraintCls && c?.id) {
        if (!ctx.classInject) ctx.classInject = new Map();
        const prev = String(ctx.classInject.get(c.id) || "");
        ctx.classInject.set(c.id, cls(prev, constraintCls));
      }
      return renderNode(c, parentLayout, false, semantics, ctx);
    })
    .join("\n");
  const kids = Array.isArray(node.children) ? node.children : [];
  const absPlan = shouldUseAbsoluteFallback(node, kids, ctx);
  if (absPlan) {
    if (!ctx.classInject) ctx.classInject = new Map();
    for (const e of absPlan.entries) {
      const prev = String(ctx.classInject.get(e.childId) || "");
      const abs = cls(
        "absolute",
        `left-[${remPx(e.left)}]`,
        `top-[${remPx(e.top)}]`,
        `w-[${remPx(e.w)}]`
      );
      ctx.classInject.set(e.childId, cls(prev, abs));
    }
    ctx.__absFallbackUsed = (Number(ctx.__absFallbackUsed) || 0) + absPlan.entries.length;
  }

  const fallbackClass = absPlan
    ? cls("relative", `min-h-[${remPx(absPlan.parent.h)}]`)
    : "";
  const classes = cls(baseSize, deco, clip, fallbackClass);
  return (
    openTag("div", classes, attrsForNode(node, absPlan ? ' data-layout-fallback="absolute"' : "", parentLayout), node, ctx) +
    (absPlan
      ? kids.map((c) => renderNode(c, parentLayout, false, semantics, ctx)).join("\n")
      : inner) +
    `</div>`
  );
}
