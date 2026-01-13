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

  const html = renderNode(ast.tree, null, true, semantics, {
    suppressBgIds,
    suppressRootBgId: bgInfo?.suppressRootBgId || null,
    fontMap,
  });

  if (!wrap) return html;

  // Required outer section (full bleed bg when present)
  const sectionStyle = bgInfo?.css
    ? ` style="background-image: ${bgInfo.css}; background-size: cover; background-position: center; background-repeat: no-repeat;"`
    : "";

  const sectionOpen = `<section class="relative flex overflow-hidden"${sectionStyle}>`;

  // Content container:
  // Use max-width based on the root Figma frame width (NOT max-w-container).
  const rootW = Math.max(1, Math.round(ast?.tree?.w || ast?.frame?.w || 1200));
  const maxWClass = `max-w-[${rem(rootW)}]`;

  const innerOpen = `<div class="w-full ${maxWClass}">`;

  return sectionOpen + "\n" + innerOpen + "\n" + html + "\n</div>\n</section>";
}
