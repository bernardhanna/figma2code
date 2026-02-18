// generator/server/backgroundFallback.js

/**
 * If any node in the tree has a video fill (kind "video" or type "VIDEO"),
 * set ast.__bg to video so the section gets data-bg-type="video" and a placeholder.
 * Call this before applyNamedBackgroundFallback so video is not overwritten by image fallback.
 */
export function setVideoBgFromTree(ast) {
  if (!ast?.tree) return ast;
  if (ast?.__bg?.kind === "video") return ast;

  function hasVideoFill(node) {
    const fills = Array.isArray(node?.fills) ? node.fills : [];
    for (const f of fills) {
      if (String(f?.kind || "").toLowerCase() === "video") return true;
      const t = String(f?.type || f?.fillType || "").toUpperCase();
      if (t === "VIDEO") return true;
    }
    return false;
  }

  let found = null;
  (function walk(n) {
    if (!n || found) return;
    if (hasVideoFill(n)) {
      found = n;
      return;
    }
    for (const c of n.children || []) walk(c);
  })(ast.tree);

  if (found) {
    const videoFill = (found.fills || []).find(
      (f) =>
        String(f?.kind || "").toLowerCase() === "video" ||
        String(f?.type || f?.fillType || "").toUpperCase() === "VIDEO"
    );
    const src = typeof videoFill?.src === "string" ? videoFill.src.trim() : "";
    let poster = typeof videoFill?.poster === "string" ? videoFill.poster.trim() : "";
    if (!poster) {
      const overlayPoster = String(ast?.meta?.overlay?.src || "").trim();
      if (overlayPoster) poster = overlayPoster;
    }
    ast.__bg = {
      enabled: true,
      kind: "video",
      src: typeof src === "string" ? src.trim() : "",
      poster: typeof poster === "string" ? poster.trim() : "",
      sourceNodeId: found.id,
      objectFit: "cover",
      objectPosition: "center",
    };
    ast.__bgVideoUrl = ast.__bg.src || "";
    ast.__bgPosterUrl = ast.__bg.poster || "";
  }
  return ast;
}

/**
 * Fallback background-image detection via naming convention.
 * If any node name matches common background patterns (case-insensitive),
 * we attach ast.__bg with the best-available image source.
 *
 * IMPORTANT:
 * - Prefer IMAGE FILLS first (these are the real "fill" backgrounds in Figma)
 * - Avoid accidentally using exported frame snapshots
 * - Do not overwrite when ast.__bg.kind is already "video"
 */
export function applyNamedBackgroundFallback(ast) {
  if (ast?.__bg?.kind === "video") return ast;
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

  function isWrapperType(node) {
    const t = String(node?.type || "").toUpperCase();
    return t === "FRAME" || t === "GROUP" || t === "INSTANCE" || t === "COMPONENT";
  }

  function pickSrcFromDirectIfSafe(node) {
    // Avoid using frame/instance snapshot exports as “background”
    if (isWrapperType(node)) return "";
    return pickSrcFromDirect(node);
  }

  function findBestFillImageDeep(root) {
    let best = "";
    (function walk(n) {
      if (!n || best) return;
      const fromFills = pickSrcFromFills(n);
      if (fromFills) { best = fromFills; return; }
      for (const c of n.children || []) walk(c);
    })(root);
    return best;
  }

  function findBestDirectImageDeep(root) {
    let best = "";
    (function walk(n) {
      if (!n || best) return;
      // Only accept direct sources from non-wrapper nodes
      const fromDirect = pickSrcFromDirectIfSafe(n);
      if (fromDirect) { best = fromDirect; return; }
      for (const c of n.children || []) walk(c);
    })(root);
    return best;
  }

  function pickVideoFromNode(node) {
    const fills = Array.isArray(node?.fills) ? node.fills : [];
    for (const f of fills) {
      if (String(f?.kind || "").toLowerCase() !== "video") continue;
      const s = [f?.src, f?.url, f?.video?.src].find((x) => typeof x === "string" && x.trim());
      const p = [f?.poster, f?.posterUrl, f?.poster?.src].find((x) => typeof x === "string" && x.trim());
      return { src: s ? String(s).trim() : "", poster: p ? String(p).trim() : "" };
    }
    return null;
  }

  function findBestVideoDeep(root) {
    let best = { src: "", poster: "" };
    (function walk(n) {
      if (!n || (best.src && best.poster)) return;
      const v = pickVideoFromNode(n);
      if (v && (v.src || v.poster)) {
        best = v;
        return;
      }
      for (const c of n.children || []) walk(c);
    })(root);
    return best.src || best.poster ? best : null;
  }

  const VIDEO_NAMES = ["hero video", "background video", "video", "videobg", "herovideo", "backgroundvideo"];
  function matchesVideoName(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return false;
    return VIDEO_NAMES.some((k) => n.includes(k));
  }

  let videoFound = null;
  (function walk(n) {
    if (!n || videoFound) return;
    if (matchesVideoName(n.name)) {
      const v = pickVideoFromNode(n) || findBestVideoDeep(n);
      videoFound = {
        node: n,
        src: v?.src ?? "",
        poster: v?.poster ?? "",
      };
      return;
    }
    for (const c of n.children || []) walk(c);
  })(ast?.tree);

  if (videoFound) {
    ast.__bg = {
      enabled: true,
      kind: "video",
      src: videoFound.src,
      poster: videoFound.poster,
      sourceNodeId: videoFound.node.id,
      objectFit: "cover",
      objectPosition: "center",
    };
    ast.__bgVideoUrl = ast.__bg.src || "";
    ast.__bgPosterUrl = ast.__bg.poster || "";
    return ast;
  }

  // Find a node by naming convention anywhere in the tree (image)
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
    findBestFillImageDeep(found) ||   // NEW helper: scans subtree fills only
    pickSrcFromFills(found) ||        // keep (fills on node)
    pickSrcFromDirectIfSafe(found) || // safer direct fallback
    findBestDirectImageDeep(found) || // last resort direct scan
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
