// generator/auto/autoLayoutify/sizing.js
import { cls, num, pos, rem, spacingClass } from "./precision.js";
import { SELF } from "./layoutGridFlex.js";
import { hasOwnBoxDeco } from "./styles.js";
import { normalizeSizingIntent, resolveAxisIntentsFromLayoutModel } from "../layoutModel.js";

/* ================== SIZING RULES ================== */

function isMediaLike(node) {
  const tag = String(node?.tag || "").toLowerCase();
  const name = String(node?.name || "").toLowerCase();
  const key = String(node?.key || "").toLowerCase();
  if (tag === "img") return true;
  return (
    name.includes("image") ||
    name.includes("img") ||
    name.includes("cover") ||
    key.includes("image") ||
    key.includes("img") ||
    key.includes("cover")
  );
}

function isButtonLike(node) {
  const tag = String(node?.tag || "").toLowerCase();
  const name = String(node?.name || "").toLowerCase();
  const key = String(node?.key || "").toLowerCase();
  if (tag === "button") return true;
  return name.includes("button") || name.includes("cta") || key.includes("button") || key.includes("cta");
}

function isIconWrapperLike(node) {
  const name = String(node?.name || "").toLowerCase();
  const key = String(node?.key || "").toLowerCase();
  const hasKids = Array.isArray(node?.children) && node.children.length > 0;
  const w = Number(node?.w);
  const h = Number(node?.h);
  const tiny = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 48 && h <= 48;
  const tag = String(node?.tag || "").toLowerCase();
  return hasKids && (tiny || /\b(icon|arrow|chevron|caret|glyph)\b/.test(name) || /\b(icon|arrow|chevron|caret|glyph)\b/.test(key) || tag === "svg");
}

function shouldPreferFixedForFillInRow(node) {
  const w = num(node?.size?.w) ? node.size.w : num(node?.w) ? node.w : null;
  if (!pos(w)) return false;
  if (isIconWrapperLike(node)) return true;
  if (w > 280) return false;
  return isButtonLike(node);
}

function shouldUseResponsiveFixedWidth(node, widthPx) {
  const w = Number(widthPx);
  if (!Number.isFinite(w) || w <= 0) return false;
  if (isMediaLike(node)) return false;
  // Keep tiny fixed elements (icons, badges, bars) strictly fixed.
  if (w < 180) return false;
  return true;
}

const normalizeIntent = (raw) => normalizeSizingIntent(raw).toUpperCase();

export function resolveAxisIntents(node, parentLayout = null) {
  const fromModel = resolveAxisIntentsFromLayoutModel(node, parentLayout);
  if (fromModel?.widthIntent || fromModel?.heightIntent) {
    return {
      widthIntent: normalizeIntent(fromModel.widthIntent),
      heightIntent: normalizeIntent(fromModel.heightIntent),
    };
  }
  const parent = String(parentLayout || "").toUpperCase();
  const size = node?.size || {};
  const auto = node?.auto || {};

  // In parent flow, child sizing intent is axis-relative.
  if (parent === "HORIZONTAL" || parent === "VERTICAL") {
    const widthRaw = parent === "HORIZONTAL" ? size.primary : size.counter;
    const heightRaw = parent === "VERTICAL" ? size.primary : size.counter;
    return {
      widthIntent: normalizeIntent(widthRaw || auto.primarySizing),
      heightIntent: normalizeIntent(heightRaw || auto.counterSizing),
    };
  }

  // Fallback to node-local intent.
  const autoLayout = String(auto.layout || "").toUpperCase();
  if (autoLayout === "HORIZONTAL") {
    return {
      widthIntent: normalizeIntent(auto.primarySizing || size.primary),
      heightIntent: normalizeIntent(auto.counterSizing || size.counter),
    };
  }
  if (autoLayout === "VERTICAL") {
    return {
      widthIntent: normalizeIntent(auto.counterSizing || size.counter || size.primary),
      heightIntent: normalizeIntent(auto.primarySizing || size.primary || size.counter),
    };
  }

  return {
    widthIntent: normalizeIntent(size.primary || auto.primarySizing),
    heightIntent: normalizeIntent(size.counter || auto.counterSizing),
  };
}

export function widthTokensForNode(node, parentLayout, { forText = false } = {}) {
  const widthPlan = node?.__responsivePlan?.width || null;
  if (widthPlan?.base === "full") {
    const out = ["w-full", "max-w-full"];
    if (widthPlan.md === "1/2") out.push("md:w-1/2");
    else if (typeof widthPlan.md === "string" && widthPlan.md.trim()) out.push(`md:w-${widthPlan.md.trim()}`);
    if (widthPlan.lg === "1/2") out.push("lg:w-1/2");
    else if (typeof widthPlan.lg === "string" && widthPlan.lg.trim()) out.push(`lg:w-${widthPlan.lg.trim()}`);
    if (widthPlan.md || widthPlan.lg) out.push("shrink-0");
    return out;
  }
  const s = node?.size || {};
  const w = num(s.w) ? s.w : num(node?.w) ? node.w : null;
  if (!pos(w)) return [];

  const intent = normalizeSizingIntent(s.primary || node?.auto?.primarySizing);
  // Text/content blocks: full width on mobile, fixed width from md up so small screens aren't over-constrained.
  if (forText) {
    if (shouldUseResponsiveFixedWidth(node, w)) {
      return ["w-full", `md:w-[${rem(w)}]`, "max-w-full"];
    }
    return [`w-[${rem(w)}]`, "max-w-full"];
  }

  // In horizontal and grid contexts we stack/reflow on mobile; keep fixed widths at md+.
  if (
    (parentLayout === "HORIZONTAL" || parentLayout === "GRID") &&
    shouldUseResponsiveFixedWidth(node, w) &&
    intent !== "FILL"
  ) {
    return ["w-full", `md:w-[${rem(w)}]`, "max-w-full", "shrink-0"];
  }

  // Vertical/other: same responsive behavior so fixed-width content isn't narrow on small viewports.
  if (shouldUseResponsiveFixedWidth(node, w) && intent !== "FILL") {
    return ["w-full", `md:w-[${rem(w)}]`, "max-w-full", "shrink-0"];
  }

  return [`w-[${rem(w)}]`, "max-w-full", "shrink-0"];
}

export function fixedBoxSize(node, allowH = false) {
  const s = node.size || {};
  const w = num(s.w) ? s.w : num(node.w) ? node.w : null;
  const h = num(s.h) ? s.h : num(node.h) ? node.h : null;

  const out = [];
  if (pos(w)) out.push(`w-[${rem(w)}]`, "max-w-full");
  if (allowH && pos(h)) out.push(`h-[${rem(h)}]`);
  return out.join(" ");
}

export function sizeClassForLeaf(node, parentLayout, isRoot, isText) {
  if (isText) {
    return cls(...widthTokensForNode(node, parentLayout, { forText: true }));
  }
  if (!parentLayout || parentLayout === "GRID") return "";

  const s = node.size || {};
  const h = num(s.h ?? node.h) ? (s.h ?? node.h) : null;
  const { widthIntent, heightIntent } = resolveAxisIntents(node, parentLayout);
  if (parentLayout === "HORIZONTAL") {
    if (isIconWrapperLike(node) && num(s.w ?? node.w)) {
      return cls(...widthTokensForNode(node, "HORIZONTAL"), pos(h) ? `h-[${rem(h)}]` : "");
    }
    const forceFixed = widthIntent === "FILL" && shouldPreferFixedForFillInRow(node);
    const widthTokens =
      widthIntent === "FILL" && !forceFixed
        ? ["grow", "basis-0", "min-w-0"]
        : widthIntent === "FIXED" || forceFixed
          ? widthTokensForNode(node, "HORIZONTAL")
          : [];
    if (widthTokens.length) return cls(...widthTokens, heightIntent === "FIXED" && pos(h) ? `h-[${rem(h)}]` : "");
    if (num(s.w ?? node.w) && !widthIntent) return cls(...widthTokensForNode(node, "HORIZONTAL"), pos(h) ? `h-[${rem(h)}]` : "");
    return "";
  }
  if (parentLayout === "VERTICAL") {
    const out = [];
    if (widthIntent === "FILL") out.push("w-full", "max-w-full");
    else if (widthIntent === "FIXED") out.push(...widthTokensForNode(node, "VERTICAL"));
    else if (!widthIntent && num(s.w ?? node.w)) out.push(...widthTokensForNode(node, "VERTICAL"));

    if (heightIntent === "FILL") out.push("grow", "basis-0", "min-h-0");
    else if ((heightIntent === "FIXED" || !heightIntent) && pos(h)) out.push(`h-[${rem(h)}]`);
    return cls(...out);
  }
  return "";
}

export function sizeClassForImg(node, parentLayout) {
  const classes = [];
  if (!parentLayout) classes.push("w-full");
  else if (parentLayout === "HORIZONTAL") {
    if (num(node.w)) classes.push(`basis-[${rem(node.w)}]`, "shrink-0");
    else classes.push("w-full");
  } else {
    classes.push("w-full");
  }

  if (pos(node.h)) classes.push(`h-[${rem(node.h)}]`);
  return cls(...classes);
}

export function childSizing(node, parentLayout) {
  const s = node.size || {};
  const out = [];
  const { widthIntent, heightIntent } = resolveAxisIntents(node, parentLayout);

  if (parentLayout === "GRID") {
    const h = num(s.h) ? s.h : num(node.h) ? node.h : null;
    const widthTokens = widthTokensForNode(node, "GRID");
    if (widthTokens.length && hasOwnBoxDeco(node)) {
      return cls(...widthTokens, pos(h) ? `h-[${rem(h)}]` : "");
    }
    return "";
  }

  if (parentLayout === "HORIZONTAL") {
    if (isIconWrapperLike(node) && (num(s.w) || num(node.w))) {
      out.push(...widthTokensForNode(node, "HORIZONTAL"));
      return out.join(" ");
    }
    const forceFixed = widthIntent === "FILL" && shouldPreferFixedForFillInRow(node);
    if (widthIntent === "FILL" && !forceFixed) out.push("grow", "basis-0", "min-w-0");
    else if (forceFixed) out.push(...widthTokensForNode(node, "HORIZONTAL"));
    else if (widthIntent === "FIXED" || (!widthIntent && (num(s.w) || num(node.w)))) {
      out.push(...widthTokensForNode(node, "HORIZONTAL"));
    }
  } else if (parentLayout === "VERTICAL") {
    if (widthIntent === "FILL") out.push("w-full", "max-w-full");
    else if (widthIntent === "FIXED" || (!widthIntent && (num(s.w) || num(node.w)))) out.push(...widthTokensForNode(node, "VERTICAL"));

    if (heightIntent === "FILL") out.push("grow", "basis-0", "min-h-0");
  }
  return out.join(" ");
}

export function alignSelf(node) {
  const a = node.size?.align;
  if (!a) return "";
  if (a === "STRETCH") return "";
  return SELF[a] || "";
}

/** Conservative side padding on small viewports; avoid ultra-wide gutters on phones. */
const MOBILE_MAX_PADDING_PX_X = 20;
/** Top/bottom can stay roomier than side gutters on small viewports. */
const MOBILE_MAX_PADDING_PX_Y = 80;
/** Very large side padding should only activate on large desktop viewports. */
const LARGE_SIDE_PADDING_PX = 80;

function paddingClasses(prefix, px, opts = {}) {
  const value = Number(px);
  if (!Number.isFinite(value) || value <= 0) return [];
  const { forcePxBracket, axis = "y", responsivePlan = null } = opts;
  const isHorizontal = axis === "x";
  const mobileCap = isHorizontal ? MOBILE_MAX_PADDING_PX_X : MOBILE_MAX_PADDING_PX_Y;
  const responsiveBp = isHorizontal && value > LARGE_SIDE_PADDING_PX ? "xl" : "md";
  const sidePlan = isHorizontal ? responsivePlan?.paddingX || null : null;
  if (sidePlan && (prefix === "pl" || prefix === "pr")) {
    const lgPx = prefix === "pl" ? Number(sidePlan.lgLeftPx || 0) : Number(sidePlan.lgRightPx || 0);
    const basePx = Number(sidePlan.basePx || 0);
    if (lgPx > 0 && basePx > 0) {
      const baseClass = spacingClass(prefix, basePx);
      const desktopClass = spacingClass(prefix, lgPx);
      return [baseClass, desktopClass ? `lg:${desktopClass}` : ""].filter(Boolean);
    }
  }
  const out = [];
  if (value > mobileCap) {
    out.push(spacingClass(prefix, mobileCap));
    const desktopClass = spacingClass(prefix, px, forcePxBracket ? { forcePxBracket: true } : {});
    if (desktopClass) out.push(`${responsiveBp}:${desktopClass}`);
    return out;
  }
  if (forcePxBracket) {
    out.push(spacingClass(prefix, px, { forcePxBracket: true }));
    return out;
  }
  out.push(spacingClass(prefix, px));
  return out;
}

export function paddings(al, opts = {}) {
  const isHero = !!opts.isHero;
  const responsivePlan = opts?.responsivePlan?.spacing || null;
  const onWarning = typeof opts.onWarning === "function" ? opts.onWarning : null;
  const MAX_NON_HERO_PADDING_PX = 256;
  const out = [];
  if (pos(al.padT)) {
    const forcePx = !isHero && Number(al.padT) > MAX_NON_HERO_PADDING_PX;
    if (forcePx && onWarning) {
      onWarning(
        `padding-clamp: non-hero padT=${Number(al.padT)}px exceeds ${MAX_NON_HERO_PADDING_PX}px, using px bracket`
      );
    }
    out.push(
      ...paddingClasses("pt", al.padT, {
        forcePxBracket: forcePx,
        responsivePlan,
        onWarning,
        maxNonHeroPx: MAX_NON_HERO_PADDING_PX,
      })
    );
  }
  if (pos(al.padR)) {
    out.push(...paddingClasses("pr", al.padR, { axis: "x", responsivePlan }));
  }
  if (pos(al.padB)) {
    const forcePx = !isHero && Number(al.padB) > MAX_NON_HERO_PADDING_PX;
    if (forcePx && onWarning) {
      onWarning(
        `padding-clamp: non-hero padB=${Number(al.padB)}px exceeds ${MAX_NON_HERO_PADDING_PX}px, using px bracket`
      );
    }
    out.push(
      ...paddingClasses("pb", al.padB, {
        forcePxBracket: forcePx,
        responsivePlan,
        onWarning,
        maxNonHeroPx: MAX_NON_HERO_PADDING_PX,
      })
    );
  }
  if (pos(al.padL)) {
    out.push(...paddingClasses("pl", al.padL, { axis: "x", responsivePlan }));
  }
  return out.join(" ");
}
