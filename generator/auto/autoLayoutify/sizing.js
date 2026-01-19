// generator/auto/autoLayoutify/sizing.js
import { cls, num, pos, rem } from "./precision.js";
import { SELF } from "./layoutGridFlex.js";
import { hasOwnBoxDeco } from "./styles.js";

/* ================== SIZING RULES ================== */

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
  if (isText) return "";
  if (!parentLayout || parentLayout === "GRID") return "";

  const s = node.size || {};
  const h = num(s.h ?? node.h) ? (s.h ?? node.h) : null;
  if (parentLayout === "HORIZONTAL") {
    if (s.primary === "FILL") return cls("grow basis-0 min-w-0", pos(h) ? `h-[${rem(h)}]` : "");
    if (num(s.w ?? node.w)) {
      return cls(`w-[${rem(s.w ?? node.w)}]`, "max-w-full", "shrink-0", pos(h) ? `h-[${rem(h)}]` : "");
    }
    return "";
  }
  if (parentLayout === "VERTICAL") {
    if (s.primary === "FILL") return cls("grow basis-0 min-h-0", pos(h) ? `h-[${rem(h)}]` : "");
    return pos(h) ? `h-[${rem(h)}]` : "";
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

  if (parentLayout === "GRID") {
    const w = num(s.w) ? s.w : num(node.w) ? node.w : null;
    const h = num(s.h) ? s.h : num(node.h) ? node.h : null;
    if (pos(w) && hasOwnBoxDeco(node)) {
      return cls(
        `w-[${rem(w)}]`,
        "max-w-full",
        pos(h) ? `h-[${rem(h)}]` : ""
      );
    }
    return "";
  }

  if (parentLayout === "HORIZONTAL") {
    if (s.primary === "FILL") out.push("grow", "basis-0", "min-w-0");
    else {
      const w = num(s.w) ? s.w : num(node.w) ? node.w : null;
      if (pos(w)) out.push(`w-[${rem(w)}]`, "max-w-full", "shrink-0");
    }
  } else if (parentLayout === "VERTICAL") {
    if (s.primary === "FILL") out.push("grow", "basis-0", "min-h-0");
  }
  return out.join(" ");
}

export function alignSelf(node) {
  const a = node.size?.align;
  if (!a) return "";
  if (a === "STRETCH") return "";
  return SELF[a] || "";
}

export function paddings(al) {
  const out = [];
  if (pos(al.padT)) out.push(`pt-[${rem(al.padT)}]`);
  if (pos(al.padR)) out.push(`pr-[${rem(al.padR)}]`);
  if (pos(al.padB)) out.push(`pb-[${rem(al.padB)}]`);
  if (pos(al.padL)) out.push(`pl-[${rem(al.padL)}]`);
  return out.join(" ");
}
