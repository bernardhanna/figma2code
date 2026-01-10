// generator/auto/autoLayoutify/layoutGridFlex.js
import { cls } from "./precision.js";
import { nameHints, shouldRenderAsLinkOrButton } from "./semantics.js";

/* ------------------ layout enums ------------------ */

export const JUSTIFY = {
  MIN: "justify-start",
  CENTER: "justify-center",
  MAX: "justify-end",
  SPACE_BETWEEN: "justify-between",
};

export const ITEMS = {
  MIN: "items-start",
  CENTER: "items-center",
  MAX: "items-end",
  BASELINE: "items-baseline",
};

export const SELF = {
  MIN: "self-start",
  CENTER: "self-center",
  MAX: "self-end",
  BASELINE: "self-baseline",
  STRETCH: "", // explicitly disabled
};

/* ------------- grid vs flex selection ------------- */

export function descendantTextRatio(node, depth = 2) {
  if (!node || depth < 0) return { text: 0, total: 0 };
  let text = node.text ? 1 : 0;
  let total = 1;
  for (const c of node.children || []) {
    const r = descendantTextRatio(c, depth - 1);
    text += r.text;
    total += r.total;
  }
  return { text, total };
}

export function isTextualGroup(node) {
  const kids = node.children || [];
  if (!kids.length) return false;

  let textish = 0;
  let media = 0;

  for (const k of kids) {
    if (k.text) {
      textish++;
      continue;
    }

    const r = descendantTextRatio(k, 2);
    if (r.total > 0 && r.text / r.total >= 0.6) {
      textish++;
      continue;
    }

    if (k.img || (Array.isArray(k.fills) && k.fills.some((f) => f?.kind === "image"))) media++;
  }

  return textish >= Math.ceil(kids.length * 0.6) && media === 0;
}

/**
 * CTA child detector
 * - If container children are mostly CTA-like, we should NOT use grid.
 * - This avoids the common "two CTAs become grid-cols-2" mismatch.
 */
export function isCtaChild(node, semantics) {
  if (!node) return false;

  // AI semantics tag
  const sem = semantics?.[node.id];
  const tag = sem?.tag ? String(sem.tag).toLowerCase() : "";
  if (tag === "a" || tag === "button") return true;

  // Name hint
  const n = String(node.name || "").toLowerCase();
  if (/\b(btn|button|cta)\b/.test(n)) return true;

  // Clickability
  if (node.actions?.openUrl || node.actions?.isClickable) return true;

  // Leaf heuristic: has fills + rounded + single text child
  const kids = node.children || [];
  const oneTextChild = kids.length === 1 && !!kids[0]?.text;
  const rounded =
    !!node.r && Object.values(node.r).some((v) => typeof v === "number" && v > 0);
  const hasAnyFill =
    Array.isArray(node.fills) && node.fills.some((f) => f && f.kind && f.kind !== "none");

  return oneTextChild && rounded && hasAnyFill;
}

export function shouldUseGrid(node, semantics) {
  if (shouldRenderAsLinkOrButton(node)) return false;

  const al = node.auto;
  if (!al || al.layout === "NONE") return false;

  // NEVER grid for vertical stacks (per spec)
  if (al.layout === "VERTICAL") return false;

  const kids = node.children || [];

  // ✅ CTA Guard: if this is mostly CTA children, force flex (never grid)
  if (kids.length >= 2) {
    const ctaCount = kids.filter((k) => isCtaChild(k, semantics)).length;
    if (ctaCount / kids.length >= 0.5) return false;
  }

  const hints = nameHints(node);
  if (hints.colsHint && hints.colsHint >= 2 && hints.colsHint <= 6) return true;

  if (isTextualGroup(node)) return false;
  if (kids.length < 2) return false;

  const ws = kids.map((k) => k.w || 0).filter((w) => w > 0);
  if (ws.length < 2) return false;

  // --- NEW: strict equal-width gate for "simple horizontal rows" ---
  const wMin = Math.min(...ws);
  const wMax = Math.max(...ws);

  // If any width is missing/zero, don't trust grid
  if (!(wMin > 0 && isFinite(wMin) && isFinite(wMax))) return false;

  const ratio = wMax / wMin;

  // "Equal width" threshold:
  // - 1.00 = perfect
  // - 1.10 = within 10% (reasonable for CTAs/cards)
  const nearEqual = ratio <= 1.10;

  // If this is a small horizontal group (2–3 items) and they are NOT equal width,
  // prefer flex so intrinsic widths are preserved.
  if (kids.length <= 3 && !nearEqual) return false;

  // For larger sets, grid can still be valid if it's a repeated-item layout.
  // Keep a relaxed check for 4+ items to avoid breaking card grids.
  if (kids.length >= 4) {
    if (ratio <= 1.20) return true;
  }

  // If near-equal, grid is fine
  if (nearEqual) return true;

  // Otherwise default to flex
  return false;
}


export function gridColsFor(node) {
  const kids = node.children || [];
  const hints = nameHints(node);
  if (hints.colsHint) return Math.max(1, Math.min(6, hints.colsHint));
  const count = kids.length;
  if (count === 2) return 2;
  if (count === 3) return 3;
  if (count >= 6) return 4;
  if (count >= 4) return 3;
  return 2;
}

export function gridColsResponsive(maxCols) {
  const out = ["grid", "grid-cols-1"];
  if (maxCols >= 2) out.push(`md:grid-cols-${maxCols}`);
  return out.join(" ");
}


export function flexResponsiveClasses(al, kids) {
  const base = ["flex", "flex-col"];

  // Desktop direction mirrors Figma auto layout
  const dirDesktop = al.layout === "HORIZONTAL" ? "md:flex-row" : "md:flex-col";
  base.push(dirDesktop);

  if (al.layout === "HORIZONTAL" && (kids?.length || 0) >= 3) base.push("md:flex-wrap");

  const justMd = JUSTIFY[al.primaryAlign || "MIN"];
  const itemsMd = ITEMS[al.counterAlign || "MIN"];
  if (justMd) base.push(`md:${justMd}`);
  if (itemsMd) base.push(`md:${itemsMd}`);

  return cls(...base);
}
