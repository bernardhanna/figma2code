// generator/auto/autoLayoutify/background.js
import { escCssUrl } from "./escape.js";
import { gradientToCss } from "./paint.js";
import { hasImageFill, hasGradientFill, firstFill } from "./styles.js";

export function detectSectionBackground(root, ast) {
  // Determine the best *real* background source (video or image):
  // Priority:
  // 0) Root VIDEO fill → section gets data-bg-type="video" (codeit renders <video> or placeholder)
  // 1) Root IMAGE fill src
  // 2) Covering decorative child IMAGE fill src (and suppress that child)
  // 3) ast.__bg.src (named fallback)
  // 4) placeholder
  const picked = pickBackgroundSource(root, ast);

  if (picked?.kind === "video") {
    const videoUrl = picked.src || "";
    const posterUrl = picked.poster || "";
    if (ast && typeof ast === "object") {
      ast.__bgVideoUrl = videoUrl;
      ast.__bgPosterUrl = posterUrl;
      if (!ast.__bg || typeof ast.__bg !== "object") ast.__bg = {};
      ast.__bg.kind = "video";
      ast.__bg.src = videoUrl;
      ast.__bg.poster = posterUrl;
      if (!ast.__bg.objectFit) ast.__bg.objectFit = "cover";
      if (!ast.__bg.objectPosition) ast.__bg.objectPosition = "center";
    }
    const suppressChildIds = new Set(findDecorativeBgChildIds(root));
    if (picked.sourceNodeId && picked.sourceNodeId !== root?.id) {
      suppressChildIds.add(picked.sourceNodeId);
    }
    return {
      kind: "video",
      videoUrl,
      posterUrl,
      css: "",
      suppressRootBgId: null,
      suppressChildIds: Array.from(suppressChildIds),
    };
  }

  const bg = cssBackgroundFromPick(root, ast, picked, {
    includeGradient: true,
    preferPlaceholder: false,
    allowRealSrc: true,
  });

  // Suppress obvious decorative bg children AND additionally suppress the chosen bg child (if any)
  const suppressChildIds = new Set(findDecorativeBgChildIds(root));
  if (picked?.sourceNodeId && picked.sourceNodeId !== root?.id) {
    suppressChildIds.add(picked.sourceNodeId);
  }

  const hasBgCss = typeof bg?.image === "string" && bg.image.trim().length > 0;

  return {
    css: bg.image || "",
    blendMode: bg.blend || "",
    size: bg.size || "cover",
    position: bg.position || "center",
    repeat: bg.repeat || "no-repeat",
    suppressRootBgId: hasBgCss ? root?.id || null : null,
    suppressChildIds: Array.from(suppressChildIds),
  };
}

/* ================== Picking logic ================== */

function isVideoFill(f) {
  if (!f || typeof f !== "object") return false;
  if (String(f.kind || "").toLowerCase() === "video") return true;
  if (String(f.type || f.fillType || "").toUpperCase() === "VIDEO") return true;
  return false;
}

function pickVideoFromFills(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : [];
  for (const f of fills) {
    if (!isVideoFill(f)) continue;
    const src = [f?.src, f?.url, f?.video?.src].find((s) => typeof s === "string" && s.trim());
    const poster = [f?.poster, f?.posterUrl, f?.poster?.src].find((s) => typeof s === "string" && s.trim());
    const videoSrc = src ? String(src).trim() : "";
    if (!videoSrc) continue;
    return {
      kind: "video",
      src: videoSrc,
      poster: poster ? String(poster).trim() : "",
      sourceNodeId: node?.id || null,
    };
  }
  return null;
}

function pickVideoPosterFromFills(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : [];
  for (const f of fills) {
    if (!isVideoFill(f)) continue;
    const poster = [f?.poster, f?.posterUrl, f?.poster?.src].find(
      (s) => typeof s === "string" && s.trim()
    );
    if (poster) return String(poster).trim();
  }
  return "";
}

function pickBackgroundSource(root, ast) {
  // 0) Root VIDEO fill (explicit marker from upstream) — section gets data-bg-type="video"
  const videoPick = pickVideoFromFills(root);
  if (videoPick) return videoPick;
  const rootVideoPoster = pickVideoPosterFromFills(root);
  if (rootVideoPoster) {
    return {
      src: rootVideoPoster,
      sourceNodeId: root?.id || null,
      kind: "rootVideoPoster",
    };
  }

  // 0b) ast.__bg with kind "video" (e.g. from named fallback or normalizer)
  if (ast?.__bg?.kind === "video") {
    const src = typeof ast.__bg.src === "string" ? ast.__bg.src.trim() : "";
    const poster = typeof ast.__bg.poster === "string" ? ast.__bg.poster.trim() : "";
    if (src) {
      return {
        kind: "video",
        src,
        poster: poster || "",
        sourceNodeId: ast.__bg.sourceNodeId || root?.id || null,
      };
    }
    if (poster) {
      return {
        src: poster,
        sourceNodeId: ast.__bg.sourceNodeId || root?.id || null,
        kind: "astBg",
      };
    }
  }

  // 0c) Covering child with VIDEO fill (e.g. root is a wrapper, video is on child frame)
  const childVideo = findCoveringVideoFillChild(root);
  if (childVideo) {
    return {
      kind: "video",
      src: childVideo.src || "",
      poster: childVideo.poster || "",
      sourceNodeId: childVideo.id,
    };
  }

  // 1) Root fill image is always the best signal
  const rootFillSrc = pickSrcFromFills(root);
  if (rootFillSrc?.src) {
    return {
      src: rootFillSrc.src,
      fit: rootFillSrc.fit,
      position: rootFillSrc.position,
      sourceNodeId: root?.id || null,
      kind: "rootFill",
    };
  }

  // 2) If a decorative/covering child has a fill image, prefer that
  const child = findCoveringBgFillChild(root);
  if (child?.src) {
    return { src: child.src, sourceNodeId: child.id, kind: "childFill" };
  }

  // 3) Named fallback (should already prefer fills, but we treat it as "allowed")
  const named =
    ast?.__bg?.src && typeof ast.__bg.src === "string" && ast.__bg.src.trim()
      ? ast.__bg.src.trim()
      : "";
  if (named) {
    return { src: named, sourceNodeId: ast?.__bg?.sourceNodeId || null, kind: "astBg" };
  }

  // 4) Nothing found
  return { src: "", sourceNodeId: null, kind: "none" };
}

function normalizeFitMode(fill) {
  const fit = String(fill?.objectFit || fill?.scaleMode || "").toLowerCase();
  if (fit === "contain" || fit === "fit") return "contain";
  if (fit === "tile" || fit === "repeat") return "auto";
  return "cover";
}

function normalizePosition(fill) {
  const pos = String(fill?.objectPosition || fill?.position || "").trim();
  return pos || "center";
}

function pickSrcFromFills(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : [];
  for (const f of fills) {
    if (String(f?.kind || "").toLowerCase() !== "image") continue;

    // Support multiple exporter shapes
    const candidates = [
      f?.src,
      f?.image?.src,
      f?.imageSrc,
      f?.asset?.src,
      f?.file?.src,
    ]
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => String(s).trim());

    if (candidates.length) {
      return {
        src: candidates[0],
        fit: normalizeFitMode(f),
        position: normalizePosition(f),
      };
    }
  }
  return null;
}

function findCoveringBgFillChild(root) {
  const kids = root?.children || [];
  if (!kids.length) return null;

  const pw = root?.bb?.w ?? root?.w ?? 0;
  const ph = root?.bb?.h ?? root?.h ?? 0;

  let best = null;

  for (const c of kids) {
    if (!c?.id) continue;

    const name = String(c?.name || "").toLowerCase();

    // We only consider children that look decorative or background-ish
    const namedBg = /\b(bg|background|overlay|gradient|hero)\b/.test(name);

    // Must be an IMAGE FILL (NOT c.img.src; that is usually a frame export)
    const fillSrc = pickSrcFromFills(c);
    if (!fillSrc?.src) continue;

    // Must cover most of the parent
    const cw = c?.bb?.w ?? c?.w ?? 0;
    const ch = c?.bb?.h ?? c?.h ?? 0;
    const wr = pw ? cw / pw : 0;
    const hr = ph ? ch / ph : 0;
    const covers = wr >= 0.75 && hr >= 0.75;

    if (!covers) continue;
    if (c.text) continue;

    // Prefer named bg children first
    if (namedBg) return { id: c.id, src: fillSrc.src, fit: fillSrc.fit, position: fillSrc.position };

    // Otherwise track a best candidate (first win is fine for now)
    if (!best) best = { id: c.id, src: fillSrc.src, fit: fillSrc.fit, position: fillSrc.position };
  }

  return best;
}

function findCoveringVideoFillChild(root) {
  const kids = root?.children || [];
  if (!kids.length) return null;

  const pw = root?.bb?.w ?? root?.w ?? 0;
  const ph = root?.bb?.h ?? root?.h ?? 0;

  for (const c of kids) {
    if (!c?.id) continue;
    const videoPick = pickVideoFromFills(c);
    if (!videoPick) continue;

    const name = String(c?.name || "").toLowerCase();
    const namedBg = /\b(bg|background|overlay|video|hero)\b/.test(name);
    const cw = c?.bb?.w ?? c?.w ?? 0;
    const ch = c?.bb?.h ?? c?.h ?? 0;
    const wr = pw ? cw / pw : 0;
    const hr = ph ? ch / ph : 0;
    const covers = wr >= 0.75 && hr >= 0.75;
    if (!covers && !namedBg) continue;
    if (c.text) continue;

    return {
      id: c.id,
      src: videoPick.src || "",
      poster: videoPick.poster || "",
    };
  }
  return null;
}

/* ================== CSS layering ================== */

function cssBlendMode(mode) {
  const m = String(mode || "NORMAL").toUpperCase();
  const map = {
    NORMAL: "normal",
    MULTIPLY: "multiply",
    SCREEN: "screen",
    OVERLAY: "overlay",
    DARKEN: "darken",
    LIGHTEN: "lighten",
    COLOR_DODGE: "color-dodge",
    COLOR_BURN: "color-burn",
    HARD_LIGHT: "hard-light",
    SOFT_LIGHT: "soft-light",
    DIFFERENCE: "difference",
    EXCLUSION: "exclusion",
    HUE: "hue",
    SATURATION: "saturation",
    COLOR: "color",
    LUMINOSITY: "luminosity",
  };
  return map[m] || "normal";
}

function fillToCssLayer(fill, opts = {}) {
  if (!fill || fill.visible === false) return null;
  const kind = String(fill.kind || "").toLowerCase();
  if (kind === "gradient") {
    if (!opts.includeGradient) return null;
    const g = gradientToCss(fill);
    if (!g) return null;
    return { image: g, size: "cover", position: "center", repeat: "no-repeat", blend: cssBlendMode(fill.blendMode) };
  }
  if (kind === "image") {
    const img = pickSrcFromFills({ fills: [fill] });
    if (!img?.src) return null;
    return {
      image: `url('${escCssUrl(img.src)}')`,
      size: img.fit || "cover",
      position: img.position || "center",
      repeat: img.fit === "auto" ? "repeat" : "no-repeat",
      blend: cssBlendMode(fill.blendMode),
    };
  }
  if (kind === "solid") {
    const a = typeof fill.a === "number" ? fill.a : 1;
    if (a <= 0.001) return null;
    const r = Math.round((Number(fill.r) || 0) * 255);
    const g = Math.round((Number(fill.g) || 0) * 255);
    const b = Math.round((Number(fill.b) || 0) * 255);
    const rgba = `rgba(${r},${g},${b},${a})`;
    return {
      image: `linear-gradient(${rgba}, ${rgba})`,
      size: "cover",
      position: "center",
      repeat: "no-repeat",
      blend: cssBlendMode(fill.blendMode),
    };
  }
  return null;
}

function cssBackgroundFromPick(node, ast, picked, opts = {}) {
  const fills = Array.isArray(node?.fills) ? node.fills : [];
  const layers = [];

  for (const fill of fills) {
    const layer = fillToCssLayer(fill, opts);
    if (layer) layers.push(layer);
  }

  // If selected source comes from child/ast fallback, append image layer under root fills.
  const realSrc = picked?.src && typeof picked.src === "string" ? picked.src.trim() : "";
  const hasImageLayer = layers.some((l) => String(l.image || "").startsWith("url("));
  if (opts.allowRealSrc && realSrc && !hasImageLayer) {
    layers.push({
      image: `url('${escCssUrl(realSrc)}')`,
      size: picked?.fit || "cover",
      position: picked?.position || "center",
      repeat: "no-repeat",
      blend: "normal",
    });
  }

  if (!layers.length) {
    return { image: "", blend: "", size: "cover", position: "center", repeat: "no-repeat" };
  }

  return {
    image: layers.map((l) => l.image).join(", "),
    blend: layers.map((l) => l.blend || "normal").join(", "),
    size: layers.map((l) => l.size || "cover").join(", "),
    position: layers.map((l) => l.position || "center").join(", "),
    repeat: layers.map((l) => l.repeat || "no-repeat").join(", "),
  };
}

/* ================== Decorative suppression ================== */

function findDecorativeBgChildIds(root) {
  const out = [];
  const kids = root?.children || [];
  if (!kids.length) return out;

  const pw = root?.bb?.w ?? root?.w ?? 0;
  const ph = root?.bb?.h ?? root?.h ?? 0;

  for (const c of kids) {
    const name = String(c?.name || "").toLowerCase();

    if (/\b(bg|background|overlay|gradient)\b/.test(name)) {
      out.push(c.id);
      continue;
    }

    // IMPORTANT: do NOT treat c.img.src as a background signal.
    // Only IMAGE FILLS count as "real background" candidates.
    const hasImg = hasImageFill(c);
    const hasGrad = hasGradientFill(c);
    const hasSolid = firstFill(c)?.kind === "solid";

    const cw = c?.bb?.w ?? c?.w ?? 0;
    const ch = c?.bb?.h ?? c?.h ?? 0;
    const wr = pw ? cw / pw : 0;
    const hr = ph ? ch / ph : 0;
    const covers = wr >= 0.75 && hr >= 0.75;

    if ((hasImg || hasGrad) && covers && !c.text) {
      out.push(c.id);
      continue;
    }

    if (String(root?.name || "").toLowerCase().includes("bgimage")) {
      if (c.type === "RECTANGLE" && hasSolid && !c.text) {
        out.push(c.id);
        continue;
      }
    }
  }

  return out;
}
