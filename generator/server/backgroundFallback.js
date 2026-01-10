// generator/server/backgroundFallback.js

/**
 * Fallback background-image detection via naming convention.
 * If any node name matches common background patterns (case-insensitive),
 * we attach ast.__bg with the best-available image source.
 *
 * IMPORTANT:
 * - Prefer IMAGE FILLS first (these are the real "fill" backgrounds in Figma)
 * - Avoid accidentally using exported frame snapshots
 */
export function applyNamedBackgroundFallback(ast) {
  const NAMES = [
    "backgroundimage",
    "bgimage",
    "heroimage",
    "background image",
    "bg image",
    "hero background",
    "bg",
  ];

  function matchesName(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return false;
    if (n === "backgroundimage") return true;
    return NAMES.some((k) => n.includes(k));
  }

  function isNonEmptyString(s) {
    return typeof s === "string" && s.trim().length > 0;
  }

  /**
   * Try to extract a usable image src from a node's fills.
   * Your AST may represent fills in different shapes depending on exporter:
   * - fills: [{ type: "IMAGE", src: "..." }]
   * - fills: [{ type: "IMAGE", image: { src: "..." } }]
   * - fills: [{ type: "IMAGE", imageRef: "...", src: "..." }]
   */
  function pickSrcFromFills(node) {
    const fills = Array.isArray(node?.fills) ? node.fills : [];

    for (const f of fills) {
      // Support your exporter format: { kind: "image", src: "..." }
      if (String(f?.kind || "").toLowerCase() === "image") {
        const s = typeof f?.src === "string" ? f.src.trim() : "";
        if (s) return s;
      }

      // Back-compat with any other shape:
      const type = String(f?.type || f?.fillType || "").toUpperCase();
      if (type === "IMAGE") {
        const candidates = [f?.src, f?.image?.src, f?.imageSrc, f?.asset?.src, f?.file?.src]
          .filter((s) => typeof s === "string" && s.trim());
        if (candidates.length) return String(candidates[0]).trim();
      }
    }

    return "";
  }


  /**
   * Some nodes store raster exports as node.img.src or node.image.src.
   * These are OK if they truly represent the intended background image.
   */
  function pickSrcFromDirect(node) {
    const candidates = [
      node?.img?.src,
      node?.image?.src,
      node?.imgSrc,
      node?.imageSrc,
    ].filter(isNonEmptyString);

    return candidates.length ? String(candidates[0]).trim() : "";
  }

  /**
   * Walk a subtree and find the first good background src.
   * Priority: fills image > direct img/image
   */
  function findBestBgSrcDeep(root) {
    let best = "";

    (function walk(n) {
      if (!n || best) return;

      // 1) Prefer image fills
      const fromFills = pickSrcFromFills(n);
      if (fromFills) {
        best = fromFills;
        return;
      }

      // 2) Then direct sources
      const fromDirect = pickSrcFromDirect(n);
      if (fromDirect) {
        best = fromDirect;
        return;
      }

      for (const c of n.children || []) walk(c);
    })(root);

    return best;
  }

  // Find a node by naming convention anywhere in the tree
  let found = null;

  (function walk(n) {
    if (!n || found) return;
    if (matchesName(n.name)) {
      found = n;
      return;
    }
    for (const c of n.children || []) walk(c);
  })(ast?.tree);

  if (!found) return ast;

  // Pick best source:
  // - Prefer fills on the named node
  // - Then direct sources on the named node
  // - Then scan inside it (in case it's a wrapper group/frame)
  let src =
    pickSrcFromFills(found) ||
    pickSrcFromDirect(found) ||
    findBestBgSrcDeep(found) ||
    "/assets/placeholder-hero-bg.jpg";

  ast.__bg = {
    enabled: true,
    sourceNodeId: found.id,
    src,
    objectFit: "cover",
    objectPosition: "center",
  };

  return ast;
}
