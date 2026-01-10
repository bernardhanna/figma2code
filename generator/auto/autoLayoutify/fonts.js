// generator/auto/autoLayoutify/fonts.js
/* ------------------ font helpers ------------------ */
/**
 * IMPORTANT:
 * - Tailwind supports arbitrary font-family values via font-[...]
 * - Numeric font-[700] is treated as font-weight;
 *   string/quoted font-['Inter'] is treated as font-family.
 */

export function twFontFamilyClass(family) {
  const fam = String(family || "").trim();
  if (!fam) return "";
  const safe = fam.replace(/'/g, "\\'");
  return `font-['${safe}']`;
}

export function twFontClassForFamily(family, fontMap) {
  const fam = String(family || "").trim();
  if (!fam) return "";

  // Project-specific mapping comes from opts.fontMap
  if (fontMap && typeof fontMap === "object" && fontMap[fam]) {
    return String(fontMap[fam]).trim();
  }

  // Fallback: deterministic arbitrary font-family class
  return twFontFamilyClass(fam);
}
