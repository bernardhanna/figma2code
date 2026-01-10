// generator/auto/autoLayoutify/render.js
//
// Renders normalized AST nodes into Tailwind HTML.
// Notes:
// - Background child suppression is handled via ctx.suppressBgIds
// - CTA rendering supports <a>/<button> + inner label/span + optional SVG children
// - SVG leaf rendering happens before text/button/img fallbacks
// - IMPORTANT: layoutGridFlex import is declared ONCE (fixes "already been declared")

import { cls, pos, remTypo } from "./precision.js";
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
} from "./sizing.js";

import { boxDeco, hasOwnBoxDeco } from "./styles.js";
import { refineCtaClasses } from "./ctaRefine.js";

import { resolveCtaInnerHtml, resolveCtaLabel } from "./ctaLabel.js";
import { renderSvgLeaf } from "./svgRender.js";

/* ------------------ tag helpers ------------------ */

function openTag(tag, classes = "", attrs = "", node) {
  const nodeId = node?.id ? ` data-node-id="${node.id}"` : "";
  return `<${tag}${nodeId}${attrs}${classes ? ` class="${classes}"` : ""}>`;
}

function attrsForNode(node, extra = "") {
  const dn = node?.id ? ` data-node="${escAttr(node.id)}"` : "";
  return dn + (extra || "");
}

/* ------------------ CTA text helpers ------------------ */

function collectTextNodesDeep(node, out = []) {
  if (!node) return out;
  if (node.text && typeof node.text.raw === "string" && node.text.raw.trim()) {
    out.push(node);
  }
  for (const c of node.children || []) collectTextNodesDeep(c, out);
  return out;
}

function clamp01(x) {
  const n = Number(x);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rgba01ToCss(rgba) {
  if (!rgba) return "";
  const r01 = rgba.r, g01 = rgba.g, b01 = rgba.b;
  if (typeof r01 !== "number" || typeof g01 !== "number" || typeof b01 !== "number") return "";

  const r = Math.round(clamp01(r01) * 255);
  const g = Math.round(clamp01(g01) * 255);
  const b = Math.round(clamp01(b01) * 255);

  const a = typeof rgba.a === "number" ? clamp01(rgba.a) : 1;
  // Tailwind arbitrary values accept rgba(...)
  return `rgba(${r},${g},${b},${a})`;
}

function remPx(px) {
  const n = Number(px);
  if (!isFinite(n) || n <= 0) return "";
  // match your rem precision approach
  const v = (n / 16).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${v}rem`;
}

function fixedSizeClassesForCta(node) {
  // Only apply when we actually have dimensions
  const w = typeof node?.w === "number" ? node.w : null;
  const h = typeof node?.h === "number" ? node.h : null;

  if (!w || !h) return "";

  // Prefer fixed sizing when the node sizing indicates fixed
  const isFixed =
    node?.size?.primary === "FIXED" ||
    node?.size?.counter === "FIXED" ||
    node?.auto?.primarySizing === "FIXED" ||
    node?.auto?.counterSizing === "FIXED";

  if (!isFixed) return "";

  // Desktop: enforce figma size. Mobile: allow w-full via existing classes/wrappers.
  return cls(`lg:w-[${remPx(w)}]`, `lg:h-[${remPx(h)}]`, "lg:min-h-0");
}


function typographyClassesFromRecovered(node, ctx) {
  if (!node) return "";

  // Prefer the explicit recovered typography payload
  const t = node?.cta?.typography || null;

  // Fallback: instance text run can also carry typographic props
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

  const ital =
    (t?.italic === true) || (run0?.italic === true) ? "italic" : "";

  const tt =
    (t?.uppercase === true) || (run0?.uppercase === true) ? "uppercase" : "";

  const decoText =
    (t?.decoration || run0?.decoration) === "underline"
      ? "underline"
      : (t?.decoration || run0?.decoration) === "line-through"
        ? "line-through"
        : "";

  // Color: support either hex (if you add later) OR RGBA 0..1 as exported now
  const rgbaCss = rgba01ToCss(run0?.color || null);
  const color = rgbaCss ? `text-[${rgbaCss}]` : "";

  // Centering: keep minimal; alignment is mostly handled by button layout
  return cls(
    ffClass,
    fs,
    lh,
    ls,
    fw,
    color,
    ital,
    decoText,
    tt
  );
}


function typographyClassesFromTextNode(textNode, ctx) {
  if (!textNode) return "";

  const t = textNode.text || {};
  const typo = textNode.typography || {};

  // family
  const family = String(
    typo.family || t.fontFamily || t.family || t.fontName?.family || ""
  ).trim();
  const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap) : "";

  // size/line-height/letter-spacing
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

  // weight
  const weight = typeof typo.weight === "number" ? typo.weight : t.fontWeight;
  const fw = weight ? `font-[${weight}]` : "";

  // color
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
  // Prefer actual Figma text in descendants
  const texts = collectTextNodesDeep(node, []);
  const fromText = (texts[0]?.text?.raw || "").trim();
  if (fromText) return fromText;

  // Then CTA resolver (may look at semantic annotations)
  const fromResolver = (resolveCtaLabel(node, semantics) || "").trim();
  if (fromResolver) return fromResolver;

  // Then AI label (often generic)
  const fromAI = (aiLabelFor(node, semantics) || "").trim();
  if (fromAI) return fromAI;

  // Never use node.name as primary label (it is usually "CTA Button")
  return "";
}

/* ================== CORE RENDER ================== */

export function renderNode(node, parentLayout, isRoot, semantics, ctx = {}) {
  // Suppress only background CHILD layers (never suppress the root render)
  if (!isRoot && ctx?.suppressBgIds?.has(node.id)) return "";

  const isAuto = node.auto && node.auto.layout && node.auto.layout !== "NONE";
  return isAuto
    ? renderAuto(node, isRoot, semantics, parentLayout, ctx)
    : renderLeaf(node, parentLayout, isRoot, semantics, ctx);
}

/* ------------------ auto container ------------------ */

function renderAuto(node, isRoot, semantics, parentLayout, ctx) {
  const al = node.auto;

  // Keep consistent rem precision for layout gaps
  const gap = pos(al.itemSpacing)
    ? `gap-[${(al.itemSpacing / 16)
      .toFixed(6)
      .replace(/0+$/, "")
      .replace(/\.$/, "")}rem]`
    : "";

  const pad = paddings(al);

  // Omit background fills on the root node (background is applied on <section>)
  const omitBg = isRoot && ctx?.suppressRootBgId === node.id;

  const decoBase = boxDeco(node, /*isText=*/ false, /*omitBg=*/ omitBg);
  const deco = cls(decoBase);
  const clip = node.clipsContent ? "overflow-hidden" : "";

  const useGrid = shouldUseGrid(node, semantics);
  const layoutClasses = useGrid
    ? gridColsResponsive(gridColsFor(node))
    : flexResponsiveClasses(al, node.children || []);

  let tag = aiTagFor(node, semantics) || shouldRenderAsLinkOrButton(node) || "div";
  const containerOk = new Set(["div", "section", "nav", "header", "footer", "a", "button"]);
  if (!containerOk.has(tag)) tag = "div";

  const hrefFromAI = aiHrefFor(node, semantics);

  const isButtonTag = tag === "button";
  const isLinkTag = tag === "a";
  const isButtonLikeLink = isLinkTag && (node.actions?.openUrl || hrefFromAI);

  // IMPORTANT: auto-layout CTAs must use CTA label/inner render, not node.name fallback.
  const isCtaContainer = isButtonTag || isButtonLikeLink;

  // CTA baseline classes (match your manual conventions more closely)
  const refined = isCtaContainer ? refineCtaClasses(node) : null;

  const ctaFixed = isCtaContainer ? fixedSizeClassesForCta(node) : "";

  const ctaBase =
    isCtaContainer
      ? cls(
        "btn",
        // keep your current behaviour but don’t hard-force w-full here
        "inline-flex justify-center items-center gap-2",
        "whitespace-nowrap",
        "hover:opacity-90 transition-opacity duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        refined?.pad || "",
        refined?.minH || "",
        ctaFixed
      )
      : "";


  const container = cls(layoutClasses, gap, pad, deco, clip, ctaBase);

  const pieces = (node.children || [])
    .map((child) => {
      if (ctx?.suppressBgIds?.has(child.id)) return null;

      const sizing = childSizing(child, useGrid ? "GRID" : al.layout);
      const self = alignSelf(child);

      const needWrap =
        !!sizing ||
        !!self ||
        hasOwnBoxDeco(child) ||
        (child.auto && child.auto.layout !== "NONE");

      const inner = renderNode(child, useGrid ? "GRID" : al.layout, false, semantics, ctx);
      if (!needWrap) return inner;

      const wrap = cls(sizing, self);
      return openTag("div", wrap, "", child) + inner + "</div>";
    })
    .filter(Boolean)
    .join("\n");

  // Attributes
  const hrefAttr =
    isLinkTag ? ` href="${escAttr(hrefFromAI || node.actions?.openUrl || "#")}"` : "";
  const typeAttr = isButtonTag ? ` type="button"` : "";

  // CTA label (for aria + fallback span)
  const label = isCtaContainer ? bestCtaLabel(node, semantics) : (aiLabelFor(node, semantics) || "").trim();

  const aria =
    isCtaContainer && label ? ` aria-label="${escAttr(label)}"` : "";

  // CTA inner:
  // - If children rendered, keep them (they contain real text nodes w/ styles).
  // - If empty, render a <span> with typography derived from the best descendant text node.
  let body = pieces;

  if (isCtaContainer) {
    if (!body || !String(body).trim()) {
      // 1) Prefer recovered instance typography (node.cta.typography / __instanceText)
      const recoveredTypo = typographyClassesFromRecovered(node, ctx);

      // 2) Else fall back to descendant text typography (rare for rasterized instances)
      const texts = collectTextNodesDeep(node, []);
      const descendantTypo = typographyClassesFromTextNode(texts[0], ctx);

      const typoCls = recoveredTypo || descendantTypo;

      const safeLabel = label || ""; // do not fall back to node.name
      body = safeLabel
        ? `<span${typoCls ? ` class="${escAttr(typoCls)}"` : ""}>${escAttr(safeLabel)}</span>`
        : "";
    }
  }
 else {
    // Non-CTA container fallback
    body = body || "";
  }

  return (
    openTag(tag, container, attrsForNode(node, hrefAttr + typeAttr + aria), node) +
    body +
    `</${tag}>`
  );
}

/* ------------------ leaf ------------------ */

function renderLeaf(node, parentLayout, isRoot, semantics, ctx) {
  // 1) SVG/VECTOR leaf support (so CTA arrows appear)
  const svg = renderSvgLeaf(node);
  if (svg) return svg;

  const isText = !!node.text;

  const aiLeafTag = aiTagFor(node, semantics);
  const aiLeafHref = aiHrefFor(node, semantics);
  const aiLeafLabel = aiLabelFor(node, semantics);

  /* -------- TEXT leaf -------- */
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

    // Font family: class only (NO inline style)
    const family = String(
      typo.family || t.fontFamily || t.family || t.fontName?.family || ""
    ).trim();
    const ffData = family ? ` data-ff="${escAttr(family)}"` : "";
    const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap) : "";

    // Exact font-size / line-height / letter-spacing
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

    // Color: prefer hex when available, otherwise allow empty
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
      openTag(tag, classes, attrsForNode(node, ffData), node) +
      (t.raw || "") +
      `</${tag}>`
    );
  }

  /* -------- CTA / clickable leaf -------- */
  // (kept for non-auto CTAs)
  /* -------- CTA / clickable leaf -------- */
  const forced =
    aiLeafTag === "a" || aiLeafTag === "button"
      ? aiLeafTag
      : shouldRenderAsLinkOrButton(node);

  if (forced === "a" || forced === "button") {
    const deco = boxDeco(node, /*isText=*/false, /*omitBg=*/false);
    const clip = node.clipsContent ? "overflow-hidden" : "";
    const baseSize = sizeClassForLeaf(node, parentLayout, isRoot, false);

    const refined = refineCtaClasses(node);

    const href = aiHrefFor(node, semantics) || node.actions?.openUrl || "";
    const isLink = forced === "a" || !!href;
    const tag = isLink ? "a" : "button";

    // Prefer recovered CTA label, then semantic label, then node name
    const recoveredLabel = (node?.cta?.label || "").trim();
    const label = recoveredLabel || resolveCtaLabel(node, semantics) || "";
    const aria = label ? ` aria-label="${escAttr(label)}"` : "";

    // Try render children (text + svg)
    let inner = resolveCtaInnerHtml(node, semantics, (c) =>
      renderNode(c, parentLayout, false, semantics, ctx)
    );

    // Fallback: if rasterized instance has no children, inject <span> label
    if (!inner || !String(inner).trim()) {
      // Typography from recovered CTA payload (if present)
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

      // Color: allow a hex string or a rgba object depending on your upstream
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
      openTag(tag, classes, attrsForNode(node, hrefAttr + targetAttr + typeAttr + aria), node) +
      inner +
      `</${tag}>`
    );
  }


  /* -------- IMG leaf -------- */
  if (node.img?.src) {
    const deco = boxDeco(node, /*isText=*/ false, /*omitBg=*/ true);
    const clip = node.clipsContent ? "overflow-hidden" : "";
    const sizeForImg = sizeClassForImg(node, parentLayout);
    const classes = cls(sizeForImg, deco, clip, "object-cover");

    const alt = escAttr(node.name || "Image");
    return `<img src="${escAttr(node.img.src)}" alt="${alt}" loading="lazy" decoding="async"${classes ? ` class="${classes}"` : ""
      }>`;
  }

  /* -------- Generic leaf -------- */
  const deco = boxDeco(node, /*isText=*/ false, /*omitBg=*/ false);
  const clip = node.clipsContent ? "overflow-hidden" : "";
  const baseSize = sizeClassForLeaf(node, parentLayout, isRoot, false);

  const inner = (node.children || [])
    .map((c) => renderNode(c, parentLayout, false, semantics, ctx))
    .join("\n");

  const classes = cls(baseSize, deco, clip);
  return openTag("div", classes, attrsForNode(node), node) + inner + `</div>`;
}
