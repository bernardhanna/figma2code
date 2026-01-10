// generator/server/diagnosticsRasterCta.js

export function findRasterizedClickableInstancesWithoutText(ast) {
  const offenders = [];

  function hasAnyText(node) {
    if (!node) return false;
    if (node.text && typeof node.text.raw === "string" && node.text.raw.trim()) return true;
    if (node.cta && typeof node.cta.label === "string" && node.cta.label.trim()) return true;

    // plugin-provided capture
    if (
      Array.isArray(node.__instanceText) &&
      node.__instanceText.some((x) => x && x.raw && String(x.raw).trim())
    )
      return true;

    // descendants
    const kids = node.children || [];
    for (const k of kids) if (hasAnyText(k)) return true;
    return false;
  }

  function walk(node) {
    if (!node) return;
    const type = String(node.type || "").toUpperCase();
    const clickable = !!node.actions?.isClickable;
    const raster = !!node.img?.src;

    if (type === "INSTANCE" && clickable && raster && !hasAnyText(node)) {
      offenders.push({
        id: node.id,
        name: node.name || "",
        img: node.img?.src || "",
      });
    }

    for (const c of node.children || []) walk(c);
  }

  walk(ast?.tree);

  return offenders;
}
