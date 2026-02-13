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
    const suppressChildIds = new Set(findDecorativeBgChildIds(root));
    if (picked.sourceNodeId && picked.sourceNodeId !== root?.id) {
      suppressChildIds.add(picked.sourceNodeId);
    }
    return {
      kind: "video",
      videoUrl: picked.src || "",
      posterUrl: picked.poster || "",
      css: "",
      suppressRootBgId: null,
      suppressChildIds: Array.from(suppressChildIds),
    };
  }

  const css = cssBackgroundFromPick(root, ast, picked, {
    includeGradient: true,
    preferPlaceholder: false,
    allowRealSrc: true,
  });

  // Suppress obvious decorative bg children AND additionally suppress the chosen bg child (if any)
  const suppressChildIds = new Set(findDecorativeBgChildIds(root));
  if (picked?.sourceNodeId && picked.sourceNodeId !== root?.id) {
    suppressChildIds.add(picked.sourceNodeId);
  }

  const hasBgCss = typeof css === "string" && css.trim().length > 0;

  return {
    css,
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
    return { kind: "video", src: src ? String(src).trim() : "", poster: poster ? String(poster).trim() : "", sourceNodeId: node?.id || null };
  }
  return null;
}

function pickBackgroundSource(root, ast) {
  // 0) Root VIDEO fill (explicit marker from upstream) — section gets data-bg-type="video"
  const videoPick = pickVideoFromFills(root);
  if (videoPick) return videoPick;

  // 0b) ast.__bg with kind "video" (e.g. from named fallback or normalizer)
  if (ast?.__bg?.kind === "video") {
    const src = typeof ast.__bg.src === "string" ? ast.__bg.src.trim() : "";
    const poster = typeof ast.__bg.poster === "string" ? ast.__bg.poster.trim() : "";
    return {
      kind: "video",
      src: src || "",
      poster: poster || "",
      sourceNodeId: ast.__bg.sourceNodeId || root?.id || null,
    };
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
  if (rootFillSrc) {
    return { src: rootFillSrc, sourceNodeId: root?.id || null, kind: "rootFill" };
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

    if (candidates.length) return candidates[0];
  }
  return "";
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
    if (!fillSrc) continue;

    // Must cover most of the parent
    const cw = c?.bb?.w ?? c?.w ?? 0;
    const ch = c?.bb?.h ?? c?.h ?? 0;
    const wr = pw ? cw / pw : 0;
    const hr = ph ? ch / ph : 0;
    const covers = wr >= 0.75 && hr >= 0.75;

    if (!covers) continue;
    if (c.text) continue;

    // Prefer named bg children first
    if (namedBg) return { id: c.id, src: fillSrc };

    // Otherwise track a best candidate (first win is fine for now)
    if (!best) best = { id: c.id, src: fillSrc };
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

function cssBackgroundFromPick(node, ast, picked, opts = {}) {
  const w = Math.max(1, Math.round(node?.w || ast?.frame?.w || 1600));
  const h = Math.max(1, Math.round(node?.h || ast?.frame?.h || 900));

  // IMPORTANT: We do NOT use node.img.src anywhere.
  const realSrc = picked?.src && typeof picked.src === "string" ? picked.src.trim() : "";

  let imgUrl = "";
  if (opts.allowRealSrc && realSrc) {
    imgUrl = realSrc;
  }

  const urlLayer = imgUrl ? `url('${escCssUrl(imgUrl)}')` : "";

  let gradientLayer = "";
  if (opts.includeGradient) {
    // Keep gradient from root node by default (most common pattern)
    const fills = Array.isArray(node?.fills) ? node.fills : [];
    const g = fills.find((f) => f?.kind === "gradient");
    if (g) {
      const gcss = gradientToCss(g);
      if (gcss) gradientLayer = gcss;
    }
  }

  const layers = [];
  if (gradientLayer) layers.push(gradientLayer);
  if (urlLayer) layers.push(urlLayer);

  // If there is neither a gradient nor a real image src, do NOT synthesize
  // a placeholder. Just return empty so preview uses plain background.
  if (!layers.length) return "";

  return layers.join(", ");
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
