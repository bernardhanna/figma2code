// generator/templates/preview/preview.fonts.scan.js

export function scanFontsFromAst(root) {
  const map = new Map(); // family -> {family, weights:Set}
  (function walk(n) {
    if (!n) return;

    const t = n?.text || null;
    const fam = String(
      t?.fontFamily || t?.family || t?.fontName?.family || ""
    ).trim();
    if (fam) {
      const w = Number(
        t?.fontWeight || t?.fontName?.style?.match(/\d+/)?.[0] || 400
      );
      if (!map.has(fam)) map.set(fam, { family: fam, weights: new Set() });
      if (Number.isFinite(w) && w > 0) map.get(fam).weights.add(w);
    }
    for (const c of n.children || []) walk(c);
  })(root);

  return [...map.values()].map((v) => ({
    family: v.family,
    weights: [...v.weights],
  }));
}
