// generator/templates/preview.html.js
// Preview shell with:
// - optional Figma overlay compare UI (meta.overlay.src OR group overlays)
// - optional background injection (ast.__bg OR responsive assets)
// - auto Google Fonts injection
// - APPLY PATCHES support (fixtures.out/<slug>/patches.json)
// - Responsive viewport tooling (mobile/tablet/desktop) + draggable width resizer
// - (REMOVED) One-screen responsive variant swapping (fetch-and-swap)
//
// Critical layout guarantees:
// - Overlay is positioned/clipped INSIDE #cmp_root and cannot exceed current viewport (--vpw)
// - #cmp_root width is clamped to current viewport (--vpw) and design width (--design-w)
// - device frame clips everything to viewport (overflow hidden)
// - Overlay opacity/difference are driven by CSS vars on #cmp_root + inline styles on the overlay <img>
//
// Notes:
// - CSS is sourced from generator/templates/preview/preview.styles.js to avoid duplication.
// - Tailwind responsiveness should happen naturally as viewport width changes.
// - Overlay/background can switch per bucket (mobile/tablet/desktop) without swapping markup.

import { previewCss } from "./preview/preview.styles.js";
import { viewportScript } from "./preview/preview.viewport.js";
import { patchesScript } from "./preview/preview.patches.js";
import { responsiveScript } from "./preview/preview.responsive.js";

const ENABLE_NICESELECT = String(process.env.WIDGET_NICESELECT || "").trim() === "1";
const NICESELECT_CSS =
  String(process.env.WIDGET_NICESELECT_CSS || "").trim() ||
  "https://cdn.jsdelivr.net/npm/nice-select2@2.3.0/dist/css/nice-select2.css";
const NICESELECT_CSS_FALLBACK =
  String(process.env.WIDGET_NICESELECT_CSS_FALLBACK || "").trim() ||
  "https://unpkg.com/nice-select2@2.3.0/dist/css/nice-select2.css";
const NICESELECT_JS =
  String(process.env.WIDGET_NICESELECT_JS || "").trim() ||
  "https://cdn.jsdelivr.net/npm/nice-select2@2.3.0/dist/js/nice-select2.js";
const NICESELECT_JS_FALLBACK =
  String(process.env.WIDGET_NICESELECT_JS_FALLBACK || "").trim() ||
  "https://unpkg.com/nice-select2@2.3.0/dist/js/nice-select2.js";

const ENABLE_SLICK = String(process.env.WIDGET_SLICK || "").trim() === "1";
const SLICK_CSS =
  String(process.env.WIDGET_SLICK_CSS || "").trim() ||
  "https://cdn.jsdelivr.net/npm/slick-carousel@1.8.1/slick/slick.css";
const SLICK_CSS_FALLBACK =
  String(process.env.WIDGET_SLICK_CSS_FALLBACK || "").trim() ||
  "https://unpkg.com/slick-carousel@1.8.1/slick/slick.css";
const SLICK_JS =
  String(process.env.WIDGET_SLICK_JS || "").trim() ||
  "https://cdn.jsdelivr.net/npm/slick-carousel@1.8.1/slick/slick.min.js";
const SLICK_JS_FALLBACK =
  String(process.env.WIDGET_SLICK_JS_FALLBACK || "").trim() ||
  "https://unpkg.com/slick-carousel@1.8.1/slick/slick.min.js";
const JQUERY_JS =
  String(process.env.WIDGET_SLICK_JQUERY || "").trim() ||
  "https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js";
const JQUERY_JS_FALLBACK =
  String(process.env.WIDGET_SLICK_JQUERY_FALLBACK || "").trim() ||
  "https://unpkg.com/jquery@3.7.1/dist/jquery.min.js";

function niceSelectFrameHead() {
  const cssLinks = [NICESELECT_CSS, NICESELECT_CSS_FALLBACK].filter(
    (v, i, arr) => v && arr.indexOf(v) === i
  );
  return `
  ${cssLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n  ")}
  <style>
    /* Fallback styles if nice-select2 CSS fails to load */
    .nice-select {
      position: relative;
      display: block;
      width: 100%;
      cursor: pointer;
      user-select: none;
    }
    .nice-select .current { display: block; }
    .nice-select .list {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 4px);
      display: none;
      z-index: 50;
      max-height: 260px;
      overflow: auto;
      background: #fff;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,.12);
    }
    .nice-select.open .list { display: block; }
    .nice-select .option { padding: 8px 12px; cursor: pointer; }
    .nice-select .option.selected { font-weight: 600; }
    .nice-select .option.disabled { color: rgba(0,0,0,.4); cursor: not-allowed; }
  </style>
  `;
}

function niceSelectFrameInit() {
  return `
  <script>
    (function(){
      function getImpl(){
        return window.NiceSelect || window.NiceSelect2 || window.niceSelect || window.niceSelect2 || null;
      }
      function collectTargets(){
        const nodes = Array.prototype.slice.call(
          document.querySelectorAll('[data-widget="nice-select"]')
        );
        return nodes.filter((el) => el && el.dataset && el.dataset.niceSelectReady !== "1");
      }
      function markReady(el){
        try { el.dataset.niceSelectReady = "1"; } catch {}
      }
      function applyFallback(el){
        if (!el || el.dataset.niceSelectReady === "1") return;
        const options = Array.prototype.slice.call(el.options || []);
        if (!options.length) return;

        const wrapper = document.createElement('div');
        const cls = String(el.className || '').trim();
        wrapper.className = ['nice-select', cls].filter(Boolean).join(' ');
        wrapper.tabIndex = 0;

        const current = document.createElement('span');
        current.className = 'current';
        const selected = options.find((o) => o && o.selected) || options[0];
        current.textContent = selected ? String(selected.text || selected.label || '') : '';

        const list = document.createElement('ul');
        list.className = 'list';

        options.forEach((opt) => {
          const li = document.createElement('li');
          li.className = [
            'option',
            opt.disabled ? 'disabled' : '',
            opt.selected ? 'selected' : '',
          ].filter(Boolean).join(' ');
          li.dataset.value = String(opt.value ?? '');
          li.textContent = String(opt.text || opt.label || '');
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            if (opt.disabled) return;
            options.forEach((o) => { o.selected = false; });
            opt.selected = true;
            el.value = opt.value;
            current.textContent = String(opt.text || opt.label || '');
            Array.prototype.forEach.call(list.querySelectorAll('.option'), (n) => {
              n.classList.toggle('selected', n === li);
            });
            wrapper.classList.remove('open');
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          list.appendChild(li);
        });

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          wrapper.classList.toggle('open');
        });

        el.addEventListener('change', () => {
          const opt = options.find((o) => o && o.value === el.value) || options[0];
          if (opt) current.textContent = String(opt.text || opt.label || '');
        });

        wrapper.appendChild(current);
        wrapper.appendChild(list);

        el.style.display = 'none';
        el.parentNode && el.parentNode.insertBefore(wrapper, el.nextSibling);
        markReady(el);

        if (!document.documentElement.__niceSelectFallbackBound) {
          document.documentElement.__niceSelectFallbackBound = true;
          document.addEventListener('click', () => {
            Array.prototype.forEach.call(document.querySelectorAll('.nice-select.open'), (n) => {
              n.classList.remove('open');
            });
          });
        }
      }
      function applyFallbackAll(){
        const els = collectTargets();
        if (!els.length) return;
        els.forEach(applyFallback);
      }
      function bindAll(impl, els){
        if (!impl || !els || !els.length) return;
        try {
          if (typeof impl.bind === 'function') {
            let ok = false;
            for (const el of els) {
              try { impl.bind(el); markReady(el); ok = true; } catch {}
            }
            if (!ok) {
              try { impl.bind(els); els.forEach(markReady); } catch {}
            }
            return;
          }
          if (typeof impl === 'function') {
            els.forEach((el) => {
              try { new impl(el); markReady(el); } catch { try { impl(el); markReady(el); } catch {} }
            });
          }
        } catch {
          // graceful fallback
        }
      }
      function init(){
        const els = collectTargets();
        if (!els.length) return;
        const impl = getImpl();
        if (!impl) return;
        bindAll(impl, els);
      }
      function loadAndInit(){
        if (getImpl()) { init(); return; }
        const sources = ["${NICESELECT_JS}", "${NICESELECT_JS_FALLBACK}"].filter(Boolean);
        let i = 0;
        function loadNext(){
          if (i >= sources.length) { applyFallbackAll(); return; }
          const s = document.createElement('script');
          s.src = sources[i++];
          s.onload = () => init();
          s.onerror = () => loadNext();
          document.head.appendChild(s);
        }
        loadNext();
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAndInit);
      } else {
        loadAndInit();
      }
    })();
  </script>
  `;
}

function niceSelectScript() {
  return `
  <script>
    (function(){
      function getImpl(){
        return window.NiceSelect || window.NiceSelect2 || window.niceSelect || window.niceSelect2 || null;
      }
      function collectTargets(){
        const nodes = Array.prototype.slice.call(
          document.querySelectorAll('[data-widget="nice-select"]')
        );
        return nodes.filter((el) => el && el.dataset && el.dataset.niceSelectReady !== "1");
      }
      function markReady(el){
        try { el.dataset.niceSelectReady = "1"; } catch {}
      }
      function applyFallback(el){
        if (!el || el.dataset.niceSelectReady === "1") return;
        const options = Array.prototype.slice.call(el.options || []);
        if (!options.length) return;

        const wrapper = document.createElement('div');
        const cls = String(el.className || '').trim();
        wrapper.className = ['nice-select', cls].filter(Boolean).join(' ');
        wrapper.tabIndex = 0;

        const current = document.createElement('span');
        current.className = 'current';
        const selected = options.find((o) => o && o.selected) || options[0];
        current.textContent = selected ? String(selected.text || selected.label || '') : '';

        const list = document.createElement('ul');
        list.className = 'list';

        options.forEach((opt) => {
          const li = document.createElement('li');
          li.className = [
            'option',
            opt.disabled ? 'disabled' : '',
            opt.selected ? 'selected' : '',
          ].filter(Boolean).join(' ');
          li.dataset.value = String(opt.value ?? '');
          li.textContent = String(opt.text || opt.label || '');
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            if (opt.disabled) return;
            options.forEach((o) => { o.selected = false; });
            opt.selected = true;
            el.value = opt.value;
            current.textContent = String(opt.text || opt.label || '');
            Array.prototype.forEach.call(list.querySelectorAll('.option'), (n) => {
              n.classList.toggle('selected', n === li);
            });
            wrapper.classList.remove('open');
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          list.appendChild(li);
        });

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          wrapper.classList.toggle('open');
        });

        el.addEventListener('change', () => {
          const opt = options.find((o) => o && o.value === el.value) || options[0];
          if (opt) current.textContent = String(opt.text || opt.label || '');
        });

        wrapper.appendChild(current);
        wrapper.appendChild(list);

        el.style.display = 'none';
        el.parentNode && el.parentNode.insertBefore(wrapper, el.nextSibling);
        markReady(el);

        if (!document.documentElement.__niceSelectFallbackBound) {
          document.documentElement.__niceSelectFallbackBound = true;
          document.addEventListener('click', () => {
            Array.prototype.forEach.call(document.querySelectorAll('.nice-select.open'), (n) => {
              n.classList.remove('open');
            });
          });
        }
      }
      function applyFallbackAll(){
        const els = collectTargets();
        if (!els.length) return;
        els.forEach(applyFallback);
      }
      function bindAll(impl, els){
        if (!impl || !els || !els.length) return;
        try {
          if (typeof impl.bind === 'function') {
            let ok = false;
            for (const el of els) {
              try { impl.bind(el); markReady(el); ok = true; } catch {}
            }
            if (!ok) {
              try { impl.bind(els); els.forEach(markReady); } catch {}
            }
            return;
          }
          if (typeof impl === 'function') {
            els.forEach((el) => {
              try { new impl(el); markReady(el); } catch { try { impl(el); markReady(el); } catch {} }
            });
          }
        } catch {
          // graceful fallback
        }
      }
      function initNiceSelect(){
        const els = collectTargets();
        if (!els.length) return;
        const impl = getImpl();
        if (!impl) { applyFallbackAll(); return; }
        bindAll(impl, els);
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNiceSelect);
      } else {
        initNiceSelect();
      }
    })();
  </script>
  `;
}

function slickFrameHead() {
  const cssLinks = [SLICK_CSS, SLICK_CSS_FALLBACK].filter((v, i, arr) => v && arr.indexOf(v) === i);
  return `
  ${cssLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n  ")}
  <style>
    [data-widget="slick"] { min-width: 0; }
    [data-widget="slick"].slick-initialized { display: block !important; }
    [data-widget="slick"] .slick-list { overflow: hidden; }
    [data-widget="slick"] .slick-track {
      display: flex;
      align-items: stretch;
      gap: var(--slick-gap, 0px);
    }
    [data-widget="slick"] .slick-slide { height: auto; }
    [data-slick-prev], [data-slick-next] {
      background: transparent !important;
      border: 0 !important;
      padding: 0 !important;
      width: auto !important;
      height: auto !important;
      line-height: normal !important;
      cursor: pointer !important;
      position: relative !important;
      z-index: 1 !important;
    }
    [data-slick-prev]::before, [data-slick-next]::before {
      content: none !important;
    }
    [data-slick-prev].slick-arrow, [data-slick-next].slick-arrow {
      transform: none !important;
    }
    /* Apply state-based colors from CSS variables */
    [data-slick-prev]:hover svg, [data-slick-next]:hover svg {
      color: var(--hover-color, currentColor) !important;
    }
    [data-slick-prev]:active svg, [data-slick-next]:active svg {
      color: var(--active-color, currentColor) !important;
    }
    [data-slick-prev]:focus-visible svg, [data-slick-next]:focus-visible svg {
      color: var(--focus-color, currentColor) !important;
    }
  </style>
  `;
}

function slickFrameInit() {
  return `
  <script>
    (function(){
      function getJq(){ return window.jQuery || window.$ || null; }
      function hasSlick(){
        const $ = getJq();
        return !!($ && $.fn && typeof $.fn.slick === "function");
      }
      function collectSliders(){
        return Array.prototype.slice.call(document.querySelectorAll('[data-widget="slick"]'));
      }
      function parseBool(v){
        if (v === null || typeof v === "undefined") return null;
        const s = String(v).trim().toLowerCase();
        if (s === "1" || s === "true") return true;
        if (s === "0" || s === "false") return false;
        return null;
      }
      function parseNum(v){
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      function findControl(el, attr){
        const id = el.getAttribute("data-slick-id");
        if (!id) return null;
        return document.querySelector('[' + attr + '="' + id + '"]');
      }
      function initSlick(){
        const $ = getJq();
        if (!($ && $.fn && $.fn.slick)) return;
        collectSliders().forEach((el) => {
          if (el.dataset && el.dataset.slickReady === "1") return;
          const dotsAttr = parseBool(el.getAttribute("data-slick-dots"));
          const arrowsAttr = parseBool(el.getAttribute("data-slick-arrows"));
          const autoplayAttr = parseBool(el.getAttribute("data-slick-autoplay"));
          const slidesAttr = parseNum(el.getAttribute("data-slick-slides"));
          const centerAttr = parseBool(el.getAttribute("data-slick-center"));
          const fadeAttr = parseBool(el.getAttribute("data-slick-fade"));
          const infiniteAttr = parseBool(el.getAttribute("data-slick-infinite"));

          const opts = {};
          if (dotsAttr !== null) opts.dots = dotsAttr;
          if (arrowsAttr !== null) opts.arrows = arrowsAttr;
          if (autoplayAttr !== null) opts.autoplay = autoplayAttr;
          if (slidesAttr !== null) opts.slidesToShow = slidesAttr;
          if (centerAttr !== null) opts.centerMode = centerAttr;
          if (fadeAttr !== null) opts.fade = fadeAttr;
          if (infiniteAttr !== null) opts.infinite = infiniteAttr;

          const prev = findControl(el, "data-slick-prev");
          const next = findControl(el, "data-slick-next");
          const dots = findControl(el, "data-slick-dots");

          if (prev) opts.prevArrow = $(prev);
          if (next) opts.nextArrow = $(next);
          if (dots) { opts.appendDots = $(dots); opts.dots = true; }

          if (opts.fade) opts.slidesToShow = 1;
          $(el).slick(opts);
          if (el.dataset) el.dataset.slickReady = "1";
        });
      }
      function applyFallback(){
        collectSliders().forEach((el) => {
          if (el.dataset && el.dataset.slickReady === "1") return;
          const gapAttr = parseNum(el.getAttribute("data-slick-gap"));
          el.style.display = "flex";
          if (gapAttr !== null) el.style.gap = gapAttr + "px";
          el.style.overflowX = "auto";
          el.style.scrollSnapType = "x mandatory";
          Array.prototype.forEach.call(el.children || [], (c) => {
            if (!c || c.nodeType !== 1) return;
            c.style.flex = "0 0 auto";
            c.style.scrollSnapAlign = "start";
          });
          if (el.dataset) el.dataset.slickReady = "1";
        });
      }
      function loadScriptSequence(urls, done){
        let i = 0;
        function next(){
          if (i >= urls.length) return done(false);
          const s = document.createElement("script");
          s.src = urls[i++];
          s.onload = () => done(true);
          s.onerror = () => next();
          document.head.appendChild(s);
        }
        next();
      }
      function loadAll(){
        if (hasSlick()) { initSlick(); return; }
        const jqUrls = ["${JQUERY_JS}", "${JQUERY_JS_FALLBACK}"].filter(Boolean);
        const slickUrls = ["${SLICK_JS}", "${SLICK_JS_FALLBACK}"].filter(Boolean);
        loadScriptSequence(jqUrls, () => {
          loadScriptSequence(slickUrls, () => {
            if (hasSlick()) initSlick();
            else applyFallback();
          });
        });
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadAll);
      } else {
        loadAll();
      }
    })();
  </script>
  `;
}

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

  // Frame name (used to derive responsive group + sibling variants)
  const frameName = String(
    ast?.meta?.figma?.frameName || ast?.frame?.name || ast?.tree?.name || ""
  ).trim();
  const frameBase = frameName.replace(/@.*/i, "").trim();

  const slug = String(ast?.slug || "").trim();

  // Group slug should match your server/fixtures naming (e.g. fixtures.out/home_v3).
  const groupSlug =
    String(opts.groupSlug || "").trim() || baseSlugFrom(slug) || toGroupSlug(frameBase) || slug;

  // Detect “merged responsive group mode”
  // Prefer explicit flag, otherwise infer from meta.responsive.variants when present.
  const variantsArr = Array.isArray(ast?.meta?.responsive?.variants) ? ast.meta.responsive.variants : [];
  const isMergedGroup = !!ast?.meta?.responsive?.mergedGroup || variantsArr.length >= 2;

  // ---------------------------------------------------------
  // Design widths MUST match Figma frames we are testing.
  // In merged responsive mode the carrier AST is often mobile,
  // so ast.frame.w may be 390. We must instead use stored
  // responsive widths (or variantMeta if present).
  // ---------------------------------------------------------

  // Best source: precomputed widths in ast.meta.responsive.widths
  const widthsFromMeta =
    ast?.meta?.responsive?.widths && typeof ast.meta.responsive.widths === "object"
      ? ast.meta.responsive.widths
      : null;

  // Optional: if fragmentPipeline stamped variantMeta with frame sizes
  // Example:
  // ast.meta.responsive.variantMeta = {
  //   mobile:{ frame:{w,h} }, tablet:{ frame:{w,h} }, desktop:{ frame:{w,h} }
  // }
  const variantMeta =
    ast?.meta?.responsive?.variantMeta && typeof ast.meta.responsive.variantMeta === "object"
      ? ast.meta.responsive.variantMeta
      : null;

  const variantMetaWidths = variantMeta
    ? {
        mobile: Number(variantMeta?.mobile?.frame?.w) || 0,
        tablet: Number(variantMeta?.tablet?.frame?.w) || 0,
        desktop: Number(variantMeta?.desktop?.frame?.w) || 0,
      }
    : null;

  // Fallback carrier width (legacy)
  const carrierW = Math.max(1, Math.round(ast?.frame?.w || ast?.tree?.w || 1200));

  // Resolve responsive widths (source of truth)
  const resolvedRespWidths = {
    mobile: Number(widthsFromMeta?.mobile) || Number(variantMetaWidths?.mobile) || 390,
    tablet: Number(widthsFromMeta?.tablet) || Number(variantMetaWidths?.tablet) || 1084,
    desktop: Number(widthsFromMeta?.desktop) || Number(variantMetaWidths?.desktop) || carrierW,
  };

  // Design width should be DESKTOP frame width when known; otherwise carrier
  const designW = Math.max(1, Math.round(resolvedRespWidths.desktop || carrierW));

  // NOTE: This is the source-of-truth used by preview.viewport.js preset buttons.
  const respWidths = resolvedRespWidths;

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
  const respAssets =
    ast?.meta?.responsive?.assets && typeof ast.meta.responsive.assets === "object"
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
  const groupOverlayFixtures = isMergedGroup
    ? {
        mobile: `/fixtures.out/${encodeURIComponent(groupSlug)}/figma.mobile.png`,
        tablet: `/fixtures.out/${encodeURIComponent(groupSlug)}/figma.tablet.png`,
        desktop: `/fixtures.out/${encodeURIComponent(groupSlug)}/figma.desktop.png`,
      }
    : { mobile: "", tablet: "", desktop: "" };

  // Decide group overlay candidates for each bucket:
  // 1) responsive assets (if present)
  // 2) fixtures convention
  // 3) meta.overlay.src (legacy)
  const groupOverlay = {
    mobile: assetOverlay.mobile || overlaySrcMeta || groupOverlayFixtures.mobile,
    tablet: assetOverlay.tablet || overlaySrcMeta || groupOverlayFixtures.tablet,
    desktop: assetOverlay.desktop || overlaySrcMeta || groupOverlayFixtures.desktop,
  };

  // Choose initial overlay src:
  // If we’re merged-group, default initial overlay to desktop overlay;
  // else fallback to meta overlay.
  const overlaySrcInitial =
    (isMergedGroup ? groupOverlay.desktop : "") || overlaySrcMeta || "";

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
      ? `<img class="${
          ast.layout?.imageRadius || "rounded-none"
        } block h-auto w-full" src="${escapeHtml(img.src)}" alt="${escapeHtml(
          headingText
        )}" loading="lazy" />`
      : ""
  );

  const bodyFontCss = primaryFontFamily
    ? `body{ font-family: ${cssFontStack(primaryFontFamily)}; }`
    : "";
  const css = previewCss({ bodyFontCss, designW });

  return `<!doctype html>
<html class="tw-loading">
<head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Preview – ${escapeHtml(slug)}</title>

  ${googleFonts || ""}

  <style>
html.tw-loading body { opacity: 0; }
html.tw-loading #cmp_root { visibility: hidden; }
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

      <div class="flex items-center gap-2 ml-auto flex-wrap" id="toolbar_actions">
      ${
        overlaySrcInitial
          ? `
        <div class="flex items-center gap-2" id="ov_controls">
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
          : ``
      }
      </div>
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
              data-group-ov-mobile="${escapeHtml(groupOverlay.mobile)}"
              data-group-ov-tablet="${escapeHtml(groupOverlay.tablet)}"
              data-group-ov-desktop="${escapeHtml(groupOverlay.desktop)}"
            >
              <div id="bg_layer" class="bg-layer" aria-hidden="true"></div>

<div class="content-layer">
  <iframe
    id="vp_iframe"
    title="Preview content"
    style="display:block; border:0; width:100%;"
    srcdoc="${escapeAttr(`<!doctype html>
<html class="tw-loading">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${googleFonts || ""}
  ${ENABLE_SLICK ? slickFrameHead() : ""}
  ${ENABLE_NICESELECT ? niceSelectFrameHead() : ""}
  <style>
    html, body { margin:0; padding:0; background: transparent; }
    html.tw-loading body { opacity: 0; }
  </style>
</head>
<body>
  ${fragment}
  ${ENABLE_SLICK ? slickFrameInit() : ""}
  ${ENABLE_NICESELECT ? niceSelectFrameInit() : ""}
  ${tailwindCdnLoaderScript()}
</body>
</html>`)}"
  ></iframe>
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

  <div class="overlay-toolbar" id="export_root">
    <div class="max-w-[1400px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2" id="export_controls">
        <span class="vpmeta">Export:</span>
        <select id="export_type" class="vpbtn" style="min-width:160px;">
          <option value="">Select folder</option>
        </select>
        <span id="export_components_root" class="vpmeta" title=""></span>
        <button id="export_btn" class="vpbtn" type="button">Export</button>
      </div>
    </div>
  </div>

  <!-- =========================================================
       Responsive config + minimal bucket hook (NO HTML swapping)
       ========================================================= -->
  ${responsiveScript({
    slug,
    frameName,
    designW,
    widths: respWidths,
    breakpoints: { mobileMax: 768, tabletMax: 1084 },
    groupKey: groupSlug,
    mergedGroup: isMergedGroup,
  })}

  <!-- Apply patches (shared implementation) -->
  ${patchesScript(slug)}

  <!-- Viewport sizing + bucket detection (reads window.__RESPONSIVE__) -->
  ${viewportScript({ designW, slug })}

  ${ENABLE_NICESELECT ? niceSelectScript() : ""}

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
      const exportBtn = document.getElementById('export_btn');
      const typeSelect = document.getElementById('export_type');
      const rootLabel = document.getElementById('export_components_root');
      if (!exportBtn) return;

      const qs = new URLSearchParams(location.search);
      const qsType = String(qs.get('type') || '').trim();

      const getSlug = () => String(window.__CURRENT_PREVIEW_SLUG__ || ${JSON.stringify(slug)} || "").trim();

      let componentsRoot = "";

      async function loadComponents(){
        try {
          const r = await fetch('/api/components');
          const out = await r.json().catch(() => null);
          const items = Array.isArray(out?.items) ? out.items : [];
          componentsRoot = String(out?.root || '').trim();

          if (rootLabel) {
            rootLabel.textContent = componentsRoot ? 'Root: ' + componentsRoot : 'Root: (not set)';
            rootLabel.title = componentsRoot || '';
          }

          if (typeSelect) {
            typeSelect.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select folder';
            typeSelect.appendChild(placeholder);

            for (const item of items) {
              const opt = document.createElement('option');
              opt.value = item;
              opt.textContent = item;
              typeSelect.appendChild(opt);
            }

            if (qsType && items.includes(qsType)) {
              typeSelect.value = qsType;
            }
          }
        } catch {
          if (rootLabel) rootLabel.textContent = 'Root: (unavailable)';
        }
      }

      loadComponents();

      exportBtn.addEventListener('click', async () => {
        const slug = getSlug();
        const type = String(typeSelect?.value || '').trim();
        if (!type) return alert('Select a component folder (e.g. hero).');

        try {
          exportBtn.disabled = true;
          exportBtn.textContent = 'Exporting...';

          const payload = { slug, type };
          if (componentsRoot) payload.componentsRoot = componentsRoot;

          const r = await fetch('/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          const out = await r.json().catch(() => null);
          if (!r.ok || !out?.ok) {
            const msg = out?.error ? String(out.error) : \`Export failed (\${r.status})\`;
            throw new Error(msg);
          }

          alert('Exported to: ' + out.folder);
        } catch (e) {
          alert('Export error: ' + (e && e.message ? e.message : String(e)));
        } finally {
          exportBtn.disabled = false;
          exportBtn.textContent = 'Export';
        }
      });
    })();
  </script>

  <script>
    (function(){
      const qs = new URLSearchParams(location.search);
      const embed = qs.get('embed') === '1';
      if (embed || qs.get('toolbar') === '0') {
        const tb = document.getElementById('toolbar_root');
        if (tb) tb.style.display = 'none';
        const eb = document.getElementById('export_root');
        if (eb) eb.style.display = 'none';
      }
    })();
  </script>
  ${tailwindCdnLoaderScript()}
</body>
</html>`;
}

function tailwindCdnLoaderScript() {
  return `
  <script>
    (function(){
      function markReady(){
        try {
          document.documentElement.classList.remove("tw-loading");
          document.documentElement.classList.add("tw-ready");
        } catch {}
        window.__TAILWIND_READY__ = true;
        try {
          if (window.parent && window.parent !== window) {
            window.parent.__TAILWIND_IFRAME_READY__ = true;
          }
        } catch {}
        try { document.dispatchEvent(new Event("tailwind:ready")); } catch {}
      }
      try { document.documentElement.classList.add("tw-loading"); } catch {}
      var html = (document.body && document.body.innerHTML)
        ? document.body.innerHTML
        : document.documentElement.outerHTML;
      window.tailwind = window.tailwind || {};
      window.tailwind.config = {
        content: [{ raw: html, extension: "html" }]
      };
      var s = document.createElement("script");
      s.src = "https://cdn.tailwindcss.com";
      s.async = true;
      s.onload = function(){
        var start = Date.now();
        (function waitCss(){
          if (document.querySelector("style#tailwindcss") ||
              document.querySelector("style[data-tw]") ||
              document.querySelector("style[data-tailwind]")) {
            markReady();
            return;
          }
          if (Date.now() - start > 2000) {
            markReady();
            return;
          }
          setTimeout(waitCss, 16);
        })();
      };
      s.onerror = function(){ markReady(); };
      document.head.appendChild(s);
      setTimeout(function(){
        if (!window.__TAILWIND_READY__) markReady();
      }, 2500);
    })();
  </script>
  `;
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
  if (!fam) return `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
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

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

