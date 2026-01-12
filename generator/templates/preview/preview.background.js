// generator/templates/preview/preview.background.js

export function buildBackgroundConfig(ast, overlaySrc) {
  // Only use ast.__bg if explicitly enabled; never fall back to frame export.
  const bgSrc = (() => {
    const enabled = !!ast?.__bg?.enabled;
    const s1 = enabled ? String(ast?.__bg?.src || "").trim() : "";
    if (!s1) return "";
    if (overlaySrc && s1 === overlaySrc) return "";
    return s1;
  })();

  // Default to FILL behaviour
  const bgFit = String(ast?.__bg?.objectFit || "cover");
  const bgPos = String(ast?.__bg?.objectPosition || "center");

  return { bgSrc, bgFit, bgPos };
}
