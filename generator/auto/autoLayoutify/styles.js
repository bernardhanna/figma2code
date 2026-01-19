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
  if (Array.isArray(node.shadows) && node.shadows.length) return true;
  if (num(node.opacity) && node.opacity !== 1) return true;
  if (node.blendMode && node.blendMode !== "NORMAL") return true;
  if (node.blur) return true;
  return false;
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
    out.push(`border-[${rem(stroke.weight)}]`);
    out.push(
      `border-[rgba(${Math.round(stroke.color.r * 255)},${Math.round(stroke.color.g * 255)},${Math.round(
        stroke.color.b * 255
      )},${stroke.color.a ?? 1})]`
    );
  }

  const r = node.r;
  if (r) {
    if (pos(r.tl)) out.push(`rounded-tl-[${rem(r.tl)}]`);
    if (pos(r.tr)) out.push(`rounded-tr-[${rem(r.tr)}]`);
    if (pos(r.br)) out.push(`rounded-br-[${rem(r.br)}]`);
    if (pos(r.bl)) out.push(`rounded-bl-[${rem(r.bl)}]`);
  }

  if (Array.isArray(node.shadows) && node.shadows.length) {
    const parts = node.shadows
      .map((s) => {
        const inset = s.inset ? "inset_" : "";
        return `${inset}${rem(s.x)}_${rem(s.y)}_${rem(s.blur)}_rgba(${Math.round(s.r * 255)},${Math.round(
          s.g * 255
        )},${Math.round(s.b * 255)},${s.a ?? 1})`;
      })
      .join(",");
    out.push(`shadow-[${parts}]`);
  }

  if (num(node.opacity) && node.opacity !== 1) out.push(`opacity-[${node.opacity}]`);
  if (node.blendMode && node.blendMode !== "NORMAL") out.push(blendToTW(node.blendMode));
  if (node.blur?.type === "LAYER") out.push(`blur-[${rem(node.blur.radius)}]`);
  if (node.blur?.type === "BACKGROUND") out.push(`backdrop-blur-[${rem(node.blur.radius)}]`);

  return out.join(" ");
}
