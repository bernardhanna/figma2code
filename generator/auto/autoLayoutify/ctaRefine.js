// generator/auto/autoLayoutify/ctaRefine.js
// ------------------------------------------------------------
// Deterministic CTA refinement helper.
// Use node height + (optional) first text child typography to choose:
// - padding (py-4 vs py-5)
// - min-h (min-h-14 style)
// - optional tracking-wide when letterSpacing is present
// - optional text sizing class when fontSize is present
//
// This is intentionally NOT ad-hoc. It is metric-driven.
// ------------------------------------------------------------

import { remTypo } from "./precision.js";

function firstTextDescendant(node, depth = 3) {
  if (!node || depth < 0) return null;
  if (node.text && typeof node.text.raw === "string") return node;
  for (const c of node.children || []) {
    const r = firstTextDescendant(c, depth - 1);
    if (r) return r;
  }
  return null;
}

function near(px, target, tol = 1.5) {
  return typeof px === "number" && Math.abs(px - target) <= tol;
}

export function refineCtaClasses(node) {
  const h = typeof node?.h === "number" ? node.h : null;

  // Height-driven padding/min-height.
  // Your manual CTA used: py-5 + min-h-14 (56px).
  // We map a few common heights deterministically.
  let padY = "";   // e.g. "py-4" or "py-5"
  let minH = "";   // e.g. "min-h-14" or "min-h-[3.5rem]"

  if (typeof h === "number" && h > 0) {
    if (near(h, 56)) {
      padY = "py-5";
      minH = "min-h-14"; // tailwind 3.5rem
    } else if (near(h, 52)) {
      padY = "py-4";
      minH = "min-h-[3.25rem]";
    } else if (h >= 44 && h <= 48) {
      padY = "py-3.5";
      minH = "min-h-12";
    } else if (h >= 40 && h < 44) {
      padY = "py-3";
      minH = "min-h-11";
    } else {
      // fallback: use arbitrary min-h but avoid forcing py when uncertain
      minH = `min-h-[${remTypo(h)}]`;
    }
  }

  // Default horizontal padding for CTAs (metric-driven would need width + text; keep stable)
  const padX = "px-8";

  // Type refinement based on first text descendant metrics when available.
  const tNode = firstTextDescendant(node, 3);
  const t = tNode?.text || {};
  const typo = tNode?.typography || {};

  const fontSizePx =
    typeof typo.sizePx === "number" ? typo.sizePx :
      typeof t.fontSize === "number" ? t.fontSize :
        null;

  const letterSpacingPx =
    typeof typo.letterSpacingPx === "number" ? typo.letterSpacingPx :
      typeof t.letterSpacingPx === "number" ? t.letterSpacingPx :
        0;

  // If font-size is near 20px, your manual uses text-xl.
  const textSize =
    typeof fontSizePx === "number" && near(fontSizePx, 20, 1) ? "text-xl" : "";

  // If letter-spacing exists (~0.2px = 0.0125rem), prefer tracking-wide
  // Note: Tailwind "tracking-wide" ~ 0.025em. This is a pragmatic mapping.
  const tracking =
    typeof letterSpacingPx === "number" && letterSpacingPx > 0 ? "tracking-wide" : "";

  return {
    pad: [padX, padY].filter(Boolean).join(" "),
    minH,
    type: [textSize, tracking].filter(Boolean).join(" "),
  };
}
