// generator/templates/preview/preview.fonts.js

import { scanFontsFromAst } from "./preview.fonts.scan.js";

export function buildGoogleFontsLinks(ast) {
  let fonts = Array.isArray(ast?.meta?.fonts) ? ast.meta.fonts : [];
  if (!fonts.length) fonts = scanFontsFromAst(ast?.tree);
  if (!fonts.length) return { googleFonts: "", primaryFontFamily: "" };

  const primaryFontFamily = String(fonts[0]?.family || "").trim();
  const famParts = [];

  for (const f of fonts) {
    const family = String(f?.family || "").trim();
    if (!family) continue;

    const weightsRaw = Array.isArray(f?.weights) ? f.weights : [];
    const weights = Array.from(
      new Set(
        weightsRaw
          .map((w) => Number(w))
          .filter((w) => Number.isFinite(w) && w > 0)
      )
    ).sort((a, b) => a - b);

    const famEnc = encodeURIComponent(family).replace(/%20/g, "+");
    if (weights.length)
      famParts.push("family=" + famEnc + ":wght@" + weights.join(";"));
    else famParts.push("family=" + famEnc);
  }

  if (!famParts.length) return { googleFonts: "", primaryFontFamily };

  const href =
    "https://fonts.googleapis.com/css2?" + famParts.join("&") + "&display=swap";

  const googleFonts =
    '\n  <link rel="preconnect" href="https://fonts.googleapis.com">' +
    '\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '\n  <link href="' +
    href +
    '" rel="stylesheet">\n  ';

  return { googleFonts, primaryFontFamily };
}
