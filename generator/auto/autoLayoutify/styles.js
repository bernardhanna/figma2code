// generator/auto/autoLayoutify/styles.js
import { cls, num, pos, rem } from "./precision.js";
import { visibleStroke } from "./stroke.js";
import { blendToTW } from "./paint.js";
import { gradientToCss } from "./paint.js";

export function firstFill(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  return fills.find((f) => f && f.kind && f.kind !== "none");
}

export function hasImageFill(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  return fills.some((f) => f?.kind === "image");
}

export function hasGradientFill(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  return fills.some((f) => f?.kind === "gradient");
}

export function hasOwnBoxDeco(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const hasFill = fills.some((f) => f && f.kind && f.kind !== "none");
  if (hasFill) return true;
  if (visibleStroke(node)) return true;

  const r = node.r;
  if (r && [r.tl, r.tr, r.br, r.bl].some((v) => pos(v))) return true;
  const effects = Array.isArray(node.effects) ? node.effects : [];
  if (Array.isArray(node.shadows) && node.shadows.length) return true;
  if (effects.some((e) => /SHADOW/i.test(String(e?.type || e?.kind || "")))) return true;
  if (num(node.opacity) && node.opacity !== 1) return true;
  if (node.blendMode && node.blendMode !== "NORMAL") return true;
  if (node.blur) return true;
  return false;
}

function parseShadowColor(shadow) {
  const c = shadow?.color || shadow;
  const r = Number(c?.r);
  const g = Number(c?.g);
  const b = Number(c?.b);
  const a = Number.isFinite(Number(c?.a)) ? Number(c?.a) : 1;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || a <= 0.001) return null;
  return {
    r: Math.round(Math.max(0, Math.min(1, r)) * 255),
    g: Math.round(Math.max(0, Math.min(1, g)) * 255),
    b: Math.round(Math.max(0, Math.min(1, b)) * 255),
    a: Math.max(0, Math.min(1, a)),
  };
}

function normalizeShadowEntries(node) {
  const fromShadows = Array.isArray(node?.shadows) ? node.shadows : [];
  const fromEffects = Array.isArray(node?.effects)
    ? node.effects.filter((e) => /SHADOW/i.test(String(e?.type || e?.kind || "")))
    : [];
  return [...fromShadows, ...fromEffects]
    .map((s) => {
      if (!s || s.visible === false) return null;
      const color = parseShadowColor(s);
      if (!color) return null;
      const x = Number.isFinite(Number(s.x)) ? Number(s.x) : Number(s.offsetX || s.dx || 0);
      const y = Number.isFinite(Number(s.y)) ? Number(s.y) : Number(s.offsetY || s.dy || 0);
      const blur = Number.isFinite(Number(s.blur)) ? Number(s.blur) : Number(s.radius || 0);
      const spread = Number.isFinite(Number(s.spread)) ? Number(s.spread) : Number(s.spreadRadius || 0);
      const type = String(s.type || s.kind || "").toUpperCase();
      const inset = s.inset === true || type === "INNER_SHADOW";
      return { x, y, blur, spread, inset, color };
    })
    .filter(Boolean);
}

export function shadowClassFromNode(node) {
  const entries = normalizeShadowEntries(node);
  if (!entries.length) return "";
  const parts = entries.map((s) => {
    const inset = s.inset ? "inset_" : "";
    const spreadPart = Math.abs(s.spread) > 0.001 ? `_${rem(s.spread)}` : "";
    return `${inset}${rem(s.x)}_${rem(s.y)}_${rem(s.blur)}${spreadPart}_rgba(${s.color.r},${s.color.g},${s.color.b},${s.color.a})`;
  });
  return `shadow-[${parts.join(",")}]`;
}

function opacityClassFromNode(node) {
  const raw = Number(node?.opacity);
  if (!Number.isFinite(raw)) return "";
  // Accept 0..1 (Figma) and 0..100 (percentage-like payloads).
  let normalized = raw;
  if (raw > 1 && raw <= 100) normalized = raw / 100;
  normalized = Math.max(0, Math.min(1, normalized));
  if (Math.abs(normalized - 1) <= 0.001) return "";

  const percent = Math.round(normalized * 100);
  const scale = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100];
  const nearest = scale.reduce((best, cur) =>
    Math.abs(cur - percent) < Math.abs(best - percent) ? cur : best, scale[0]);
  if (Math.abs(nearest - percent) <= 2) return `opacity-${nearest}`;

  const clean = Number(normalized.toFixed(4));
  return `opacity-[${clean}]`;
}

function radiusFromNode(node) {
  const r = node?.r || null;
  if (r && [r.tl, r.tr, r.br, r.bl].some((v) => pos(v))) {
    return {
      tl: Number(r.tl) || 0,
      tr: Number(r.tr) || 0,
      br: Number(r.br) || 0,
      bl: Number(r.bl) || 0,
    };
  }

  // Figma exports sometimes use a single cornerRadius value.
  const cr = Number(node?.cornerRadius);
  if (Number.isFinite(cr) && cr > 0) {
    return { tl: cr, tr: cr, br: cr, bl: cr };
  }
  return null;
}

function radiusClasses(node) {
  const r = radiusFromNode(node);
  if (!r) return [];
  const vals = [r.tl, r.tr, r.br, r.bl];
  const nonZero = vals.filter((v) => v > 0);
  if (!nonZero.length) return [];
  const allEqual = nonZero.length === 4 && vals.every((v) => Math.abs(v - vals[0]) < 0.001);
  if (allEqual) return [`rounded-[${rem(vals[0])}]`];
  const out = [];
  if (pos(r.tl)) out.push(`rounded-tl-[${rem(r.tl)}]`);
  if (pos(r.tr)) out.push(`rounded-tr-[${rem(r.tr)}]`);
  if (pos(r.br)) out.push(`rounded-br-[${rem(r.br)}]`);
  if (pos(r.bl)) out.push(`rounded-bl-[${rem(r.bl)}]`);
  return out;
}

function bgFromFills(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  if (!fills.length) return { bgClass: "", modeClass: "" };

  const gradients = fills.filter((f) => f.kind === "gradient");
  const images = fills.filter((f) => f.kind === "image");
  const solids = fills.filter((f) => f.kind === "solid" && (f.a ?? 1) > 0.001);

  let bgImageCss = "";
  let modeClass = "";

  if (gradients.length) {
    const gcss = gradientToCss(gradients[0]);
    if (gcss) bgImageCss = `bg-[${gcss}]`;
  } else if (solids.length) {
    const f = solids[solids.length - 1];
    const r255 = Math.round(f.r * 255);
    const g255 = Math.round(f.g * 255);
    const b255 = Math.round(f.b * 255);
    const a = f.a ?? 1;

    // Prefer hex for opaque colors (matches Figma dev tools like #EDEDED).
    if (Math.abs(a - 1) < 0.001) {
      const toHex = (n) => n.toString(16).padStart(2, "0");
      const hex = `#${toHex(r255)}${toHex(g255)}${toHex(b255)}`;
      bgImageCss = `bg-[${hex}]`;
    } else {
      bgImageCss = `bg-[rgba(${r255},${g255},${b255},${a})]`;
    }
  } else if (images.length) {
    modeClass = "bg-cover bg-no-repeat bg-center";
  }

  const bgClass = cls(bgImageCss, bgImageCss ? "bg-center" : "");
  return { bgClass, modeClass };
}

export function boxDeco(node, isText, omitBg) {
  const out = [];

  if (!isText && !omitBg) {
    const { bgClass, modeClass } = bgFromFills(node);
    if (bgClass) out.push(bgClass);
    if (modeClass) out.push(modeClass);
  }

  const stroke = visibleStroke(node);
  if (stroke) {
    const rgba = `rgba(${Math.round(stroke.color.r * 255)},${Math.round(stroke.color.g * 255)},${Math.round(
      stroke.color.b * 255
    )},${stroke.color.a ?? 1})`;
    const align = String(stroke.align || "INSIDE").toUpperCase();
    const weight = Math.max(0, Number(stroke.weight) || 0);
    if (align === "OUTSIDE") {
      out.push(`outline-[${rem(weight)}]`);
      out.push(`outline-[${rgba}]`);
      out.push("outline-offset-0");
    } else if (align === "CENTER") {
      const half = Math.max(0.25, weight / 2);
      out.push(`border-[${rem(half)}]`);
      out.push(`border-[${rgba}]`);
      out.push(`outline-[${rem(half)}]`);
      out.push(`outline-[${rgba}]`);
      out.push("outline-offset-0");
    } else {
      out.push(`border-[${rem(weight)}]`);
      out.push(`border-[${rgba}]`);
    }
  }

  out.push(...radiusClasses(node));

  const shadowClass = shadowClassFromNode(node);
  if (shadowClass) out.push(shadowClass);

  const opacityCls = opacityClassFromNode(node);
  if (opacityCls) out.push(opacityCls);
  if (node.blendMode && node.blendMode !== "NORMAL") out.push(blendToTW(node.blendMode));
  const blur = resolvedBlurInfo(node);
  if (blur?.type === "LAYER") {
    out.push(`blur-[${rem(blur.radius)}]`);
  } else if (blur?.type === "BACKGROUND") {
    const v = rem(blur.radius);
    out.push(`backdrop-blur-[${v}]`);
    // Explicit property fallback keeps frosted-glass effect even if utility generation varies.
    out.push(`[backdrop-filter:blur(${v})]`);
    out.push(`[-webkit-backdrop-filter:blur(${v})]`);
  }

  return out.join(" ");
}

function normalizedBlurType(raw) {
  const t = String(raw || "").toUpperCase().trim();
  if (t === "LAYER" || t === "LAYER_BLUR") return "LAYER";
  if (t === "BACKGROUND" || t === "BACKGROUND_BLUR") return "BACKGROUND";
  return "";
}

function blurFromEffects(node) {
  const effects = Array.isArray(node?.effects) ? node.effects : [];
  for (const e of effects) {
    if (!e || e.visible === false) continue;
    const type = normalizedBlurType(e.type || e.kind);
    if (!type) continue;
    const radius = Number(e.radius);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    return { type, radius };
  }
  return null;
}

function blurFromNode(node) {
  const b = node?.blur;
  if (!b || typeof b !== "object") return null;
  const type = normalizedBlurType(b.type || b.kind);
  if (!type) return null;
  const radius = Number(b.radius);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return { type, radius };
}

export function resolvedBlurInfo(node) {
  return blurFromNode(node) || blurFromEffects(node);
}

export function hasUnsupportedBlur(node) {
  const hasBlurSignal =
    !!(node?.blur && typeof node.blur === "object") ||
    (Array.isArray(node?.effects) &&
      node.effects.some((e) => /BLUR/i.test(String(e?.type || e?.kind || ""))));
  if (!hasBlurSignal) return false;
  return !resolvedBlurInfo(node);
}
