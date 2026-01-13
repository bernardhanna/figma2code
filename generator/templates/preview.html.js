// generator/templates/preview.html.js
// Preview shell with:
// - optional Figma overlay compare UI (meta.overlay.src OR group overlays)
// - optional background injection (ast.__bg OR responsive assets)
// - auto Google Fonts injection
// - APPLY PATCHES support (fixtures.out/<slug>/patches.json)
// - Responsive viewport tooling (mobile/tablet/desktop) + draggable width resizer
// - One-screen responsive variant swapping (fetch-and-swap) using /preview/<variantSlug>?embed=1&toolbar=0
//
// Critical layout guarantees:
// - Overlay is positioned/clipped INSIDE #cmp_root and cannot exceed current viewport (--vpw)
// - #cmp_root width is clamped to current viewport (--vpw) and design width (--design-w)
// - device frame clips everything to viewport (overflow hidden)
// - Overlay opacity/difference are driven by CSS vars on #cmp_root + inline styles on the overlay <img>
//
// Notes:
// - CSS is sourced from generator/templates/preview/preview.styles.js to avoid duplication.

import { previewCss } from "./preview/preview.styles.js";
import { viewportScript } from "./preview/preview.viewport.js";
import { patchesScript } from "./preview/preview.patches.js";

export function previewHtml(ast, opts = {}) {
  const fragmentRaw = (opts.fragment || "").trim();

  const classes = ast.content?.classes || {};
  const outer = (classes.outer || "")
    .replace(/\bflex\b/g, "")
    .replace(/\bflex-col\b/g, "")
    .replace(/\bflex-row\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const overlaySrcMeta = String(ast?.meta?.overlay?.src || "").trim();
  const overlayMetaW = Number(ast?.meta?.overlay?.w || 0) || null;
  const overlayMetaH = Number(ast?.meta?.overlay?.h || 0) || null;

  // Design width = desktop reference width
  const designW = Math.max(1, Math.round(ast?.frame?.w || ast?.tree?.w || 1200));

  // Frame name (used to derive responsive group + sibling variants)
  const frameName = String(
    ast?.meta?.figma?.frameName || ast?.frame?.name || ast?.tree?.name || ""
  ).trim();
  const frameBase = frameName.replace(/@.*/i, "").trim();

  const slug = String(ast?.slug || "").trim();

  // Group slug should match your server/fixtures naming (e.g. fixtures.out/home_v3).
  const groupSlug =
    String(opts.groupSlug || "").trim() ||
    baseSlugFrom(slug) ||
    toGroupSlug(frameBase) ||
    slug;

  // Detect “merged responsive group mode”:
  const responsiveVariants = Array.isArray(ast?.meta?.responsive?.variants)
    ? ast.meta.responsive.variants
    : [];
  const isMergedGroup = responsiveVariants.length >= 2;

  // If you have these in AST already, they win; otherwise defaults are fine.
  const respWidths = {
    mobile: Number(ast?.meta?.responsive?.widths?.mobile) || 390,
    tablet: Number(ast?.meta?.responsive?.widths?.tablet) || 1084,
    desktop: Number(ast?.meta?.responsive?.widths?.desktop) || designW,
  };

  // Overlay natural widths (used to clamp overlay max-width per bucket)
  const overlayW = {
    mobile: Number(ast?.meta?.responsive?.overlayW?.mobile) || respWidths.mobile,
    tablet: Number(ast?.meta?.responsive?.overlayW?.tablet) || respWidths.tablet,
    desktop: overlayMetaW || respWidths.desktop,
  };

  // -----------------------------
  // Responsive assets (preferred)
  // -----------------------------
  // If fragmentPipeline sets:
  // ast.meta.responsive.assets = {
  //   mobile: { overlay: "...", bg: "..." },
  //   tablet: { overlay: "...", bg: "..." },
  //   desktop:{ overlay: "...", bg: "..." }
  // }
  // then those win.
  const respAssets = (ast?.meta?.responsive?.assets && typeof ast.meta.responsive.assets === "object")
    ? ast.meta.responsive.assets
    : null;

  const assetOverlay = {
    mobile: String(respAssets?.mobile?.overlay || "").trim(),
    tablet: String(respAssets?.tablet?.overlay || "").trim(),
    desktop: String(respAssets?.desktop?.overlay || "").trim(),
  };

  const assetBg = {
    mobile: String(respAssets?.mobile?.bg || "").trim(),
    tablet: String(respAssets?.tablet?.bg || "").trim(),
    desktop: String(respAssets?.desktop?.bg || "").trim(),
  };

  // -----------------------------
  // Fallback overlay convention
  // -----------------------------
  const groupOverlayFixtures = {
    mobile: `/fixtures.out/${encodeURIComponent(groupSlug)}/figma.mobile.png`,
    tablet: `/fixtures.out/${encodeURIComponent(groupSlug)}/figma.tablet.png`,
    desktop: `/fixtures.out/${encodeURIComponent(groupSlug)}/figma.desktop.png`,
  };

  // Decide group overlay candidates for each bucket:
  // 1) responsive assets (if present)
  // 2) fixtures convention
  // 3) meta.overlay.src (legacy)
  const groupOverlay = {
    mobile: assetOverlay.mobile || groupOverlayFixtures.mobile || overlaySrcMeta,
    tablet: assetOverlay.tablet || groupOverlayFixtures.tablet || overlaySrcMeta,
    desktop: assetOverlay.desktop || groupOverlayFixtures.desktop || overlaySrcMeta,
  };

  // Choose initial overlay src:
  // - Prefer bucket-specific overlay if available
  // - Otherwise meta.overlay.src
  // - Otherwise (merged group) try desktop fixtures
  const overlaySrcInitial =
    groupOverlay.desktop || overlaySrcMeta || (isMergedGroup ? groupOverlayFixtures.desktop : "");

  // -----------------------------
  // Background (preferred: assets; fallback: ast.__bg)
  // -----------------------------
  const legacyBgEnabled = !!ast?.__bg?.enabled;
  const legacyBgSrc = legacyBgEnabled ? String(ast?.__bg?.src || "").trim() : "";

  const bgFit = String(ast?.__bg?.objectFit || "cover").trim() || "cover";
  const bgPos = String(ast?.__bg?.objectPosition || "center").trim() || "center";

  // For each bucket:
  // 1) responsive assets bg
  // 2) legacy ast.__bg (same for all)
  const groupBg = {
    mobile: assetBg.mobile || legacyBgSrc,
    tablet: assetBg.tablet || legacyBgSrc,
    desktop: assetBg.desktop || legacyBgSrc,
  };

  // If overlay equals bg, suppress background to avoid double stacking
  for (const k of ["mobile", "tablet", "desktop"]) {
    if (groupBg[k] && groupOverlay[k] && groupBg[k] === groupOverlay[k]) groupBg[k] = "";
  }

  const { googleFonts, primaryFontFamily } = buildGoogleFontsLinks(ast);

  // Slot replacements (for demo templates that still use slots)
  const headingText = ast.content?.heading?.text || "Heading";
  const subcopyHtml = ast.content?.subcopy || "";
  const img = ast.content?.image;

  let fragment = fragmentRaw;
  fragment = fragment.replace(
    "<!--SLOT:heading-->",
    `<h2 class="font-semibold leading-tight tracking-tight">${escapeHtml(headingText)}</h2>`
  );
  fragment = fragment.replace("<!--SLOT:subcopy-->", subcopyHtml || "");
  fragment = fragment.replace(
    "<!--SLOT:image_main-->",
    img
      ? `<img class="${ast.layout?.imageRadius || "rounded-none"} block h-auto w-full" src="${escapeHtml(
          img.src
        )}" alt="${escapeHtml(headingText)}" loading="lazy" />`
      : ""
  );

  const bodyFontCss = primaryFontFamily
    ? `body{ font-family: ${cssFontStack(primaryFontFamily)}; }`
    : "";
  const css = previewCss({ bodyFontCss, designW });

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>Preview – ${escapeHtml(slug)}</title>

  ${googleFonts || ""}

  <style>
${css}
  </style>
</head>

<body class="antialiased bg-white">
  <div class="overlay-toolbar" id="toolbar_root">
    <div class="max-w-[1400px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
      <div class="vpbar">
        <span class="vpmeta">Viewport:</span>
        <button id="vp_mobile" class="vpbtn" type="button" data-active="0">Mobile</button>
        <button id="vp_tablet" class="vpbtn" type="button" data-active="0">Tablet</button>
        <button id="vp_desktop" class="vpbtn" type="button" data-active="1">Desktop</button>

        <div class="vptrack">
          <span class="vpmeta">Width</span>
          <div id="vp_rail" class="vprail" role="slider" aria-label="Preview width">
            <div id="vp_thumb" class="vpthumb"></div>
          </div>
          <span id="vp_readout" class="vpmeta mono">—</span>
        </div>
      </div>

      ${
        overlaySrcInitial
          ? `
      <div class="flex items-center gap-2 ml-auto" id="ov_controls">
        <input id="ov_enabled" type="checkbox" checked />
        <label for="ov_enabled" class="text-sm font-medium">Figma overlay</label>
      </div>

      <div class="flex items-center gap-2" id="ov_opacity_wrap">
        <label class="text-sm text-slate-700">Opacity</label>
        <input id="ov_opacity" type="range" min="0" max="100" value="50" />
        <span id="ov_opacity_val" class="text-sm text-slate-700 w-12">50%</span>
      </div>

      <div class="flex items-center gap-2" id="ov_diff_wrap">
        <input id="ov_diff" type="checkbox" />
        <label for="ov_diff" class="text-sm text-slate-700">Difference</label>
      </div>

      <button id="ov_reset" class="text-sm px-3 py-1 border rounded-md bg-white hover:bg-slate-50">
        Reset
      </button>

      <button id="ov_scores" class="text-sm px-3 py-1 border rounded-md bg-white hover:bg-slate-50">
        Scores
      </button>
      `
          : `<div class="ml-auto"></div>`
      }
    </div>
  </div>

  <div class="preview-stage">
    <div id="device_frame" class="device-frame device-outline" style="--vpw:${designW}px; --design-w:${designW}px;">
      <div class="device-frame-inner">
        <section class="relative">
          <div id="ov_root" class="relative flex flex-col items-center w-full mx-auto ${outer}">
            <div
              id="cmp_root"
              style="height:auto; --oop:0.5; --obm:normal;"
              data-bg-fit="${escapeHtml(bgFit)}"
              data-bg-pos="${escapeHtml(bgPos)}"
              data-group-bg-mobile="${escapeHtml(groupBg.mobile)}"
              data-group-bg-tablet="${escapeHtml(groupBg.tablet)}"
              data-group-bg-desktop="${escapeHtml(groupBg.desktop)}"
            >
              <div id="bg_layer" class="bg-layer" aria-hidden="true"></div>

              <div class="content-layer">
                ${fragment}
              </div>

              ${
                overlaySrcInitial
                  ? `<img
                        id="ov_img"
                        data-figma-overlay="1"
                        class="overlay-img"
                        src="${escapeHtml(overlaySrcInitial)}"
                        data-ov-w="${overlayMetaW ? String(overlayMetaW) : ""}"
                        data-ov-h="${overlayMetaH ? String(overlayMetaH) : ""}"
                        data-group-ov-mobile="${escapeHtml(groupOverlay.mobile)}"
                        data-group-ov-tablet="${escapeHtml(groupOverlay.tablet)}"
                        data-group-ov-desktop="${escapeHtml(groupOverlay.desktop)}"
                        alt=""
                        aria-hidden="true"
                      />`
                  : ""
              }
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>

  <!-- =========================================================
       Responsive injection + one-screen variant swapping
       ========================================================= -->
  <script>
    (function(){
      const initialSlug = ${JSON.stringify(slug)};
      const groupKey = ${JSON.stringify(groupSlug)}; // slug-safe key (e.g. "hero_v3")
      const frameName = ${JSON.stringify(frameName)};
      const respWidths = ${JSON.stringify(respWidths)};
      const overlayW = ${JSON.stringify(overlayW)};
      const isMergedGroup = ${JSON.stringify(isMergedGroup)};

      // Current active slug used by patches/scores/compare
      // In merged-group mode, keep it group-scoped.
      window.__CURRENT_PREVIEW_SLUG__ = isMergedGroup ? groupKey : initialSlug;

      window.__RESPONSIVE__ = {
        groupKey,
        widths: respWidths,
        breakpoints: { mobileMax: 768, tabletMax: 1084 },
        overlayW,
        frameName,
        initialSlug,
        mergedGroup: isMergedGroup
      };

      const contentEl = document.querySelector("#cmp_root .content-layer");
      const ovImg = document.getElementById("ov_img");
      const cmp = document.getElementById("cmp_root");
      const bgLayer = document.getElementById("bg_layer");

      const initialContentHtml = contentEl ? contentEl.innerHTML : "";
      const initialOverlaySrc = ovImg ? (ovImg.getAttribute("src") || "") : "";
      const initialOvW = ovImg ? Number(ovImg.getAttribute("data-ov-w") || 0) : 0;

      function applyOverlayClamp(bucket){
        if (!ovImg) return;

        const attrW = Number(ovImg.getAttribute("data-ov-w") || 0);
        const ow =
          (attrW && isFinite(attrW) && attrW > 0)
            ? attrW
            : (Number(window.__RESPONSIVE__?.overlayW?.[bucket]) || 0);

        if (ow && isFinite(ow) && ow > 0) ovImg.style.maxWidth = ow + "px";
        else ovImg.style.maxWidth = "";
      }

      function uniq(arr){
        return Array.from(new Set((arr || []).map(s => String(s||"").trim()).filter(Boolean)));
      }

      function toSlug(s){
        return String(s || "")
          .trim()
          .toLowerCase()
          .replace(/\\s+/g, "_")
          .replace(/[^a-z0-9_@\\-]+/g, "")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "");
      }

      function deriveCandidateSlugs(bucket){
        const b = String(bucket || "").trim().toLowerCase();
        const out = [];

        if (groupKey) out.push(groupKey + "_" + b);

        const baseFromInitial = String(initialSlug || "").replace(/(_|-|@)(desktop|tablet|mobile)$/i, "");
        if (baseFromInitial) out.push(baseFromInitial + "_" + b);

        if (groupKey) out.push(groupKey + "-" + b);
        if (groupKey) out.push(groupKey + "@" + b);

        if (initialSlug) {
          out.push(initialSlug.replace(/(_|-|@)(desktop|tablet|mobile)$/i, "$1" + b));
          out.push(initialSlug.replace(/(desktop|tablet|mobile)$/i, b));
          out.push(initialSlug + "_" + b);
        }

        if (frameName) {
          const base = frameName.includes("@") ? frameName.split("@")[0].trim() : frameName.trim();
          if (base) {
            out.push(toSlug(base + "_" + b));
            out.push(toSlug(base + "-" + b));
            out.push(toSlug(base + "@" + b));
          }
        }

        return uniq(out);
      }

      async function fetchVariantHtml(variantSlug){
        const url = "/preview/" + encodeURIComponent(variantSlug) + "?embed=1&toolbar=0";
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("Variant not found: " + variantSlug);
        return await r.text();
      }

      function extractFromHtml(html){
        const doc = new DOMParser().parseFromString(String(html||""), "text/html");
        const c = doc.querySelector("#cmp_root .content-layer");
        const o = doc.getElementById("ov_img");
        const ow = o ? Number(o.getAttribute("data-ov-w") || 0) : 0;
        const oh = o ? Number(o.getAttribute("data-ov-h") || 0) : 0;
        const overlaySrc = o ? (o.getAttribute("src") || "") : "";

        const cmp2 = doc.getElementById("cmp_root");
        const bg =
          cmp2 ? (cmp2.getAttribute("data-group-bg-mobile") || "") : "";
        // NOTE: we don't rely on fetched bg for merged mode; this is only a best-effort extra fallback
        return {
          contentHtml: c ? c.innerHTML : "",
          overlaySrc,
          overlayW: (ow && isFinite(ow) && ow > 0) ? ow : 0,
          overlayH: (oh && isFinite(oh) && oh > 0) ? oh : 0,
          bgSrc: String(bg || "").trim(),
        };
      }

      async function reapplyPatchesIfAvailable(){
        if (typeof window.__applyPatchesForCurrentSlug__ === "function") {
          try { await window.__applyPatchesForCurrentSlug__(); } catch {}
        }
      }

      // ---------------- overlay-by-breakpoint switching ----------------
      let _ovSwapNonce = 0;

      function preferredGroupOverlaySrc(bucket){
        const b = String(bucket || "").toLowerCase();
        if (!ovImg) return "";
        const m = ovImg.getAttribute("data-group-ov-mobile") || "";
        const t = ovImg.getAttribute("data-group-ov-tablet") || "";
        const d = ovImg.getAttribute("data-group-ov-desktop") || "";
        if (b === "mobile") return m || "";
        if (b === "tablet") return t || d || "";
        return d || "";
      }

      function setOverlaySrcWithFallbacks(bucket, fetchedVariantOverlaySrc){
        if (!ovImg) return;

        const desired = preferredGroupOverlaySrc(bucket);
        const fallbacks = uniq([
          desired,
          String(fetchedVariantOverlaySrc || "").trim(),
          String(initialOverlaySrc || "").trim(),
        ]).filter(Boolean);

        if (!fallbacks.length) return;

        const nonce = ++_ovSwapNonce;
        let idx = 0;

        function trySet(){
          if (nonce !== _ovSwapNonce) return;
          const next = fallbacks[idx];
          if (!next) return;

          if (ovImg.getAttribute("src") === next) return;

          ovImg.onerror = () => {
            if (nonce !== _ovSwapNonce) return;
            idx++;
            if (idx < fallbacks.length) trySet();
          };

          ovImg.src = next;
        }

        trySet();
      }

      // ---------------- background switching ----------------
      let _bgSwapNonce = 0;

      function preferredGroupBgSrc(bucket){
        const b = String(bucket || "").toLowerCase();
        if (!cmp) return "";
        const m = cmp.getAttribute("data-group-bg-mobile") || "";
        const t = cmp.getAttribute("data-group-bg-tablet") || "";
        const d = cmp.getAttribute("data-group-bg-desktop") || "";
        if (b === "mobile") return m || "";
        if (b === "tablet") return t || d || "";
        return d || "";
      }

      function applyBgStyle(src){
        if (!bgLayer || !cmp) return;

        const fit = cmp.getAttribute("data-bg-fit") || "cover";
        const pos = cmp.getAttribute("data-bg-pos") || "center";

        if (!src) {
          bgLayer.style.backgroundImage = "";
          bgLayer.style.backgroundSize = "";
          bgLayer.style.backgroundPosition = "";
          bgLayer.style.backgroundRepeat = "";
          bgLayer.style.display = "none";
          return;
        }

        bgLayer.style.display = "block";
        bgLayer.style.backgroundImage = "url(" + JSON.stringify(String(src)) + ")";
        bgLayer.style.backgroundSize = String(fit);
        bgLayer.style.backgroundPosition = String(pos);
        bgLayer.style.backgroundRepeat = "no-repeat";
      }

      function setBgSrcWithFallbacks(bucket, fetchedVariantBgSrc){
        if (!bgLayer) return;

        const desired = preferredGroupBgSrc(bucket);
        const fallbacks = uniq([
          desired,
          String(fetchedVariantBgSrc || "").trim(),
        ]).filter(Boolean);

        // allow empty bg (explicitly none)
        const nonce = ++_bgSwapNonce;

        if (!fallbacks.length) {
          applyBgStyle("");
          return;
        }

        let idx = 0;
        function trySet(){
          if (nonce !== _bgSwapNonce) return;
          const next = fallbacks[idx];
          if (!next) { applyBgStyle(""); return; }

          // Preload so we can fall back if 404
          const img = new Image();
          img.onload = () => { if (nonce === _bgSwapNonce) applyBgStyle(next); };
          img.onerror = () => {
            if (nonce !== _bgSwapNonce) return;
            idx++;
            if (idx < fallbacks.length) trySet();
            else applyBgStyle("");
          };
          img.src = next;
        }

        trySet();
      }

      async function switchToBucket(bucket){
        const b = String(bucket || "").trim().toLowerCase();

        // Always swap bg + overlay first (so mergedGroup behaves correctly)
        setBgSrcWithFallbacks(b, "");
        setOverlaySrcWithFallbacks(b, "");
        applyOverlayClamp(b);

        if (window.__RESPONSIVE__?.mergedGroup) {
          window.__CURRENT_PREVIEW_SLUG__ = groupKey;
          await reapplyPatchesIfAvailable();
          return;
        }

        if (b === "desktop") {
          if (contentEl) contentEl.innerHTML = initialContentHtml;

          setBgSrcWithFallbacks("desktop", "");
          setOverlaySrcWithFallbacks("desktop", "");

          if (ovImg) {
            if (initialOvW && isFinite(initialOvW)) ovImg.setAttribute("data-ov-w", String(initialOvW));
            else ovImg.removeAttribute("data-ov-w");
          }

          window.__CURRENT_PREVIEW_SLUG__ = initialSlug;

          if (initialOvW && isFinite(initialOvW)) window.__RESPONSIVE__.overlayW.desktop = initialOvW;

          applyOverlayClamp("desktop");
          await reapplyPatchesIfAvailable();
          return;
        }

        const candidates = deriveCandidateSlugs(b);

        for (const s of candidates) {
          try{
            const html = await fetchVariantHtml(s);
            const { contentHtml, overlaySrc, overlayW: ow, overlayH: oh, bgSrc } = extractFromHtml(html);

            if (contentEl && contentHtml) contentEl.innerHTML = contentHtml;

            // bg: if the fetched page happened to carry a usable bg hint
            setBgSrcWithFallbacks(b, bgSrc);

            if (ovImg) {
              setOverlaySrcWithFallbacks(b, overlaySrc);

              if (ow) {
                ovImg.setAttribute("data-ov-w", String(ow));
                window.__RESPONSIVE__.overlayW[b] = ow;
              } else {
                ovImg.removeAttribute("data-ov-w");
              }

              if (oh) ovImg.setAttribute("data-ov-h", String(oh));
              else ovImg.removeAttribute("data-ov-h");

              applyOverlayClamp(b);
            }

            window.__CURRENT_PREVIEW_SLUG__ = s;
            await reapplyPatchesIfAvailable();
            return;
          } catch {
            // try next
          }
        }

        await reapplyPatchesIfAvailable();
      }

      window.__onPreviewBucketChange = ({ bucket }) => { switchToBucket(bucket); };

      function bucketForWidth(w){
        const ww = Number(w) || 0;
        if (ww > 0 && ww <= 768) return "mobile";
        if (ww > 0 && ww <= 1084) return "tablet";
        return "desktop";
      }

      (function initAssets(){
        const qs = new URLSearchParams(location.search);
        const qW = Number(qs.get("vpw"));
        const w = (isFinite(qW) && qW > 0) ? qW : (respWidths.desktop || ${designW});
        const b = bucketForWidth(w);

        setBgSrcWithFallbacks(b, "");
        setOverlaySrcWithFallbacks(b, "");
        applyOverlayClamp(b);
      })();
    })();
  </script>

  <!-- Apply patches (shared implementation) -->
  ${patchesScript(slug)}

  <!-- Viewport sizing + bucket detection (reads window.__RESPONSIVE__) -->
  ${viewportScript({ designW, slug })}

  ${
    overlaySrcInitial
      ? `
  <div id="score_modal_backdrop" class="modal-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="score_modal_title">
      <div class="modal-hd">
        <div>
          <div id="score_modal_title" class="modal-title">Visual diff scores</div>
          <div class="modal-sub">
            Slug: <span class="mono" id="score_slug_label">${escapeHtml(slug)}</span>
          </div>
        </div>
        <button id="score_modal_close" class="btn2" aria-label="Close">Close</button>
      </div>

      <div class="modal-bd">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <span id="score_pill" class="pill" data-kind="fail">No score loaded</span>
          <span id="score_main" class="mono" style="font-size:12px;color:rgba(15,23,42,.7)"></span>
        </div>

        <div class="grid">
          <div class="card">
            <div class="k">Diff ratio</div>
            <div id="score_diffRatio" class="v mono">—</div>
          </div>
          <div class="card">
            <div class="k">Diff pixels</div>
            <div id="score_diffPixels" class="v mono">—</div>
          </div>

          <div class="card">
            <div class="k">Threshold</div>
            <div id="score_threshold" class="v mono">—</div>
          </div>
          <div class="card">
            <div class="k">Pass diff ratio</div>
            <div id="score_passDiffRatio" class="v mono">—</div>
          </div>

          <div class="card">
            <div class="k">Viewport</div>
            <div id="score_viewport" class="v mono">—</div>
          </div>
          <div class="card">
            <div class="k">Timestamp</div>
            <div id="score_at" class="v mono">—</div>
          </div>
        </div>

        <div style="margin-top:14px;" class="links">
          <a id="score_link_score" href="#" target="_blank" rel="noreferrer">score.json</a>
          <a id="score_link_figma" href="#" target="_blank" rel="noreferrer">figma.png</a>
          <a id="score_link_render" href="#" target="_blank" rel="noreferrer">render.png</a>
          <a id="score_link_diff" href="#" target="_blank" rel="noreferrer">diff.png</a>
        </div>
      </div>

      <div class="modal-ft">
        <div style="font-size:12px;color:rgba(15,23,42,.7)">
          Tip: run compare after adjusting opacity/diff for a clean measurement.
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button id="score_run_compare" class="btn2 primary">Run compare</button>
          <button id="score_refresh" class="btn2">Refresh</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function(){
      const qs = new URLSearchParams(location.search);
      const ovForcedOff = qs.get('ov') === '0';

      const getSlug = () => String(window.__CURRENT_PREVIEW_SLUG__ || ${JSON.stringify(slug)} || "").trim();

      const cmp = document.getElementById('cmp_root');
      const img = document.getElementById('ov_img');
      const enabled = document.getElementById('ov_enabled');
      const opacity = document.getElementById('ov_opacity');
      const opacityVal = document.getElementById('ov_opacity_val');
      const diff = document.getElementById('ov_diff');
      const reset = document.getElementById('ov_reset');

      if (!cmp || !img) return;

      const groupKey = String(window.__RESPONSIVE__?.groupKey || "") || getSlug();
      const key = 'figmaOverlay:' + groupKey;

      const state = (() => {
        try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
      })();

      const clamp01 = (x) => Math.max(0, Math.min(1, x));
      const clampInt = (x, a, b) => Math.max(a, Math.min(b, x));

      function save(){
        const next = {
          enabled: enabled ? !!enabled.checked : true,
          opacity: clampInt(Number(opacity?.value) || 0, 0, 100),
          diff: !!diff?.checked,
        };
        localStorage.setItem(key, JSON.stringify(next));
      }

      function apply(){
        const on = !ovForcedOff && (enabled ? enabled.checked : true);
        img.classList.toggle('overlay-hidden', !on);

        const op = ovForcedOff ? 0 : clamp01((Number(opacity?.value) || 0) / 100);
        const mode = (!ovForcedOff && on && diff?.checked) ? 'difference' : 'normal';

        cmp.style.setProperty('--oop', String(op));
        cmp.style.setProperty('--obm', mode);

        img.style.opacity = String(op);
        img.style.mixBlendMode = mode;

        void img.offsetHeight;

        if (opacityVal && opacity) opacityVal.textContent = String(opacity.value || '0') + '%';
      }

      if (enabled) enabled.checked = ovForcedOff ? false : (state.enabled !== false);
      if (opacity) opacity.value = String(clampInt(Number(state.opacity ?? 50), 0, 100));
      if (diff) diff.checked = !!state.diff;

      if (enabled) enabled.addEventListener('change', () => { save(); apply(); });
      if (opacity) opacity.addEventListener('input', () => { save(); apply(); });
      if (diff) diff.addEventListener('change', () => { save(); apply(); });

      if (reset) reset.addEventListener('click', () => {
        if (enabled) enabled.checked = true;
        if (opacity) opacity.value = '50';
        if (diff) diff.checked = false;
        save(); apply();
      });

      apply();

      // Scores modal unchanged (uses window.__CURRENT_PREVIEW_SLUG__)
      const scoreBtn = document.getElementById('ov_scores');
      const modalBackdrop = document.getElementById('score_modal_backdrop');
      const modalClose = document.getElementById('score_modal_close');
      const runCompareBtn = document.getElementById('score_run_compare');
      const refreshBtn = document.getElementById('score_refresh');
      const scoreSlugLabel = document.getElementById('score_slug_label');

      const scoreEls = {
        pill: document.getElementById('score_pill'),
        main: document.getElementById('score_main'),
        diffRatio: document.getElementById('score_diffRatio'),
        diffPixels: document.getElementById('score_diffPixels'),
        threshold: document.getElementById('score_threshold'),
        passDiffRatio: document.getElementById('score_passDiffRatio'),
        viewport: document.getElementById('score_viewport'),
        at: document.getElementById('score_at'),
        linkScore: document.getElementById('score_link_score'),
        linkFigma: document.getElementById('score_link_figma'),
        linkRender: document.getElementById('score_link_render'),
        linkDiff: document.getElementById('score_link_diff'),
      };

      function pct(x){
        const n = Number(x);
        if (!isFinite(n)) return '—';
        return (n * 100).toFixed(2) + '%';
      }

      function setModalOpen(isOpen){
        if (!modalBackdrop) return;
        modalBackdrop.dataset.open = isOpen ? "1" : "0";
        modalBackdrop.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      }

      function fmtDate(iso){
        try{
          const d = new Date(String(iso||''));
          if (!isFinite(d.getTime())) return '—';
          return d.toLocaleString();
        } catch { return '—'; }
      }

      function applyScore(score){
        if (!scoreEls.pill) return;

        if (!score){
          scoreEls.pill.dataset.kind = "fail";
          scoreEls.pill.textContent = "No score found";
          scoreEls.main.textContent = "";
          scoreEls.diffRatio.textContent = "—";
          scoreEls.diffPixels.textContent = "—";
          scoreEls.threshold.textContent = "—";
          scoreEls.passDiffRatio.textContent = "—";
          scoreEls.viewport.textContent = "—";
          scoreEls.at.textContent = "—";
          return;
        }

        const pass = !!score.pass;

        scoreEls.pill.dataset.kind = pass ? "pass" : "fail";
        scoreEls.pill.textContent = pass ? "PASS" : "FAIL";

        scoreEls.main.textContent =
          \`diffRatio \${pct(score.diffRatio)} · pass<=\${pct(score.compare?.passDiffRatio)}\`;

        scoreEls.diffRatio.textContent = pct(score.diffRatio);
        scoreEls.diffPixels.textContent = String(score.diffPixels ?? '—');
        scoreEls.threshold.textContent = String(score.compare?.threshold ?? '—');
        scoreEls.passDiffRatio.textContent = pct(score.compare?.passDiffRatio);
        scoreEls.viewport.textContent =
          score.viewport?.width && score.viewport?.height
            ? \`\${score.viewport.width}×\${score.viewport.height}\`
            : '—';
        scoreEls.at.textContent = fmtDate(score.at);

        const currentSlug = getSlug();
        const base = \`/fixtures.out/\${encodeURIComponent(currentSlug)}\`;
        if (scoreEls.linkScore) scoreEls.linkScore.href = \`\${base}/score.json\`;

        const merged = !!window.__RESPONSIVE__?.mergedGroup;
        if (scoreEls.linkFigma) scoreEls.linkFigma.href = merged ? \`\${base}/figma.desktop.png\` : \`\${base}/figma.png\`;

        if (scoreEls.linkRender) scoreEls.linkRender.href = \`\${base}/render.png\`;
        if (scoreEls.linkDiff) scoreEls.linkDiff.href = \`\${base}/diff.png\`;
      }

      async function loadLatestScore(){
        try{
          const currentSlug = getSlug();
          const r = await fetch(\`/fixtures.out/\${encodeURIComponent(currentSlug)}/score.json\`, { cache: 'no-store' });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      }

      async function runCompare(){
        const currentSlug = getSlug();
        const body = { waitMs: 350, screenshot: { mode: "element", selector: "#cmp_root", minHeight: 50 } };

        const r = await fetch(\`/api/compare/\${encodeURIComponent(currentSlug)}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const out = await r.json().catch(() => null);
        if (!r.ok || !out?.ok) {
          const msg = out?.error ? String(out.error) : \`Compare failed (\${r.status})\`;
          throw new Error(msg);
        }
        return out.score;
      }

      async function openScores(){
        setModalOpen(true);
        if (scoreEls.pill) scoreEls.pill.textContent = "Loading…";
        if (scoreSlugLabel) scoreSlugLabel.textContent = getSlug();
        const score = await loadLatestScore();
        applyScore(score);
      }

      if (scoreBtn) scoreBtn.addEventListener('click', () => { openScores(); });

      if (modalClose) modalClose.addEventListener('click', () => setModalOpen(false));
      if (modalBackdrop) {
        modalBackdrop.addEventListener('click', (e) => {
          if (e.target === modalBackdrop) setModalOpen(false);
        });
      }

      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setModalOpen(false); });

      if (refreshBtn) refreshBtn.addEventListener('click', async () => {
        if (scoreEls.pill) scoreEls.pill.textContent = "Loading…";
        if (scoreSlugLabel) scoreSlugLabel.textContent = getSlug();
        const score = await loadLatestScore();
        applyScore(score);
      });

      if (runCompareBtn) runCompareBtn.addEventListener('click', async () => {
        try{
          runCompareBtn.disabled = true;
          runCompareBtn.textContent = "Running…";
          const score = await runCompare();
          applyScore(score);
        } catch (e){
          if (scoreEls.pill) {
            scoreEls.pill.dataset.kind = "fail";
            scoreEls.pill.textContent = "Compare error";
          }
          if (scoreEls.main) scoreEls.main.textContent = (e && e.message) ? e.message : String(e);
        } finally {
          runCompareBtn.disabled = false;
          runCompareBtn.textContent = "Run compare";
        }
      });
    })();
  </script>
  `
      : ""
  }

  <script>
    (function(){
      const qs = new URLSearchParams(location.search);
      const embed = qs.get('embed') === '1';
      if (embed || qs.get('toolbar') === '0') {
        const tb = document.getElementById('toolbar_root');
        if (tb) tb.style.display = 'none';
      }
    })();
  </script>
</body>
</html>`;
}

/* ---------------- helpers ---------------- */

// Matches your observed fixtures.out naming pattern: "Home v3" -> "home_v3"
function toGroupSlug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/i, "") // drop @desktop/@tablet/@mobile
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// "home_v3_mobile" -> "home_v3", "home_v3@tablet" -> "home_v3", "home_v3-desktop" -> "home_v3"
function baseSlugFrom(slug) {
  const s = String(slug || "").trim();
  if (!s) return "";
  return s.replace(/(_|-|@)(desktop|tablet|mobile)$/i, "").trim();
}

function buildGoogleFontsLinks(ast) {
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
      new Set(weightsRaw.map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0))
    ).sort((a, b) => a - b);

    const famEnc = encodeURIComponent(family).replace(/%20/g, "+");
    if (weights.length) famParts.push("family=" + famEnc + ":wght@" + weights.join(";"));
    else famParts.push("family=" + famEnc);
  }

  if (!famParts.length) return { googleFonts: "", primaryFontFamily };

  const href = "https://fonts.googleapis.com/css2?" + famParts.join("&") + "&display=swap";

  const googleFonts =
    '\n  <link rel="preconnect" href="https://fonts.googleapis.com">' +
    '\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '\n  <link href="' +
    href +
    '" rel="stylesheet">\n  ';

  return { googleFonts, primaryFontFamily };
}

function scanFontsFromAst(root) {
  const map = new Map();
  (function walk(n) {
    if (!n) return;

    const t = n?.text || null;
    const fam = String(t?.fontFamily || t?.family || t?.fontName?.family || "").trim();
    if (fam) {
      const w = Number(t?.fontWeight || t?.fontName?.style?.match(/\d+/)?.[0] || 400);
      if (!map.has(fam)) map.set(fam, { family: fam, weights: new Set() });
      if (Number.isFinite(w) && w > 0) map.get(fam).weights.add(w);
    }
    for (const c of n.children || []) walk(c);
  })(root);

  return [...map.values()].map((v) => ({ family: v.family, weights: [...v.weights] }));
}

function cssFontStack(family) {
  const fam = String(family || "").trim();
  if (!fam)
    return `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const quoted = /\s/.test(fam) ? "'" + fam.replace(/'/g, "\\'") + "'" : fam;
  return (
    quoted +
    `, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
  );
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
