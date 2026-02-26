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
import { injectHeroMediaByKeyPass } from "../auto/htmlDeterministicPasses.js";

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

function isImageLikeFill(fill) {
  const kind = String(fill?.kind || "").toLowerCase();
  const type = String(fill?.type || fill?.fillType || "").toUpperCase();
  return kind === "image" || type === "IMAGE" || type === "IMAGE_FILL";
}

function pickHeroMediaSrcFromAst(ast) {
  const root = ast?.tree || ast?.root || ast?.frameNode || ast?.node || null;
  if (!root || typeof root !== "object") return "";
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const n = queue.shift();
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    const key = String(n?.key || "").toLowerCase();
    const name = String(n?.name || "").toLowerCase();
    const isHeroMediaSlot =
      key.includes("frame:image") ||
      key.includes("frame:hero") ||
      (/\b(hero|image|video|media)\b/.test(`${key} ${name}`) &&
        !/\b(text|headline|title|copy|paragraph)\b/.test(`${key} ${name}`));
    if (isHeroMediaSlot) {
      const imgSrc = String(n?.img?.src || "").trim();
      if (imgSrc) return imgSrc;
      const fills = Array.isArray(n?.fills) ? n.fills : Array.isArray(n?.fill) ? n.fill : [];
      for (const f of fills) {
        if (!isImageLikeFill(f)) continue;
        const src = String(f?.src || f?.url || f?.image?.src || f?.asset?.src || "").trim();
        if (src) return src;
      }
    }
    if (Array.isArray(n?.children)) queue.push(...n.children);
  }
  return "";
}

const CODEMIRROR_CSS =
  String(process.env.CODEMIRROR_CSS || "").trim() ||
  "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.min.css";
const CODEMIRROR_JS =
  String(process.env.CODEMIRROR_JS || "").trim() ||
  "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.min.js";
const CODEMIRROR_MODE_XML =
  "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/xml/xml.min.js";
const CODEMIRROR_MODE_JAVASCRIPT =
  "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/javascript/javascript.min.js";
const CODEMIRROR_MODE_CSS =
  "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/css/css.min.js";
const CODEMIRROR_MODE_HTML =
  "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/htmlmixed/htmlmixed.min.js";

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

function codeMirrorAssets() {
  const scripts = [
    CODEMIRROR_JS,
    CODEMIRROR_MODE_XML,
    CODEMIRROR_MODE_JAVASCRIPT,
    CODEMIRROR_MODE_CSS,
    CODEMIRROR_MODE_HTML,
  ];

  const uniqueScripts = scripts.filter((v, i, arr) => v && arr.indexOf(v) === i);
  const uniqueCss = [CODEMIRROR_CSS].filter((v, i, arr) => v && arr.indexOf(v) === i);

  return `
  ${uniqueCss.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n  ")}
  ${uniqueScripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
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

function videoFillPreviewInit() {
  return `
  <script>
    (function(){
      const markers = ["data-bg-type", "data-fill-type", "data-media"];
      function isVideoLike(el){
        if (!el) return false;
        for (const key of markers) {
          const v = String(el.getAttribute(key) || "").trim().toLowerCase();
          if (v === "video") return true;
        }
        return false;
      }
      function ensureRelative(el){
        if (!el.classList.contains("relative")) el.classList.add("relative");
      }
      function stripBackgroundImage(el){
        const style = String(el.getAttribute("style") || "");
        if (!style) return;
        const cleaned = style
          .replace(/\\s*background-image\\s*:\\s*[^;]+;?/gi, "")
          .replace(/\\s*background-size\\s*:\\s*[^;]+;?/gi, "")
          .replace(/\\s*background-position\\s*:\\s*[^;]+;?/gi, "")
          .replace(/\\s*background-repeat\\s*:\\s*[^;]+;?/gi, "")
          .trim()
          .replace(/;\\s*;+/g, ";")
          .replace(/^\\s*;\\s*|\\s*;\\s*$/g, "");
        if (!cleaned) el.removeAttribute("style");
        else el.setAttribute("style", cleaned);
      }
      function alreadyInjected(el){
        if (el.dataset && el.dataset.videoPreviewReady === "1") return true;
        const first = el.firstElementChild;
        return !!(first && (first.tagName === "VIDEO" || (first.classList && first.classList.contains("absolute"))));
      }
      function buildMedia(el){
        const videoUrl = String(el.getAttribute("data-video-url") || el.getAttribute("data-src") || "").trim();
        const posterUrl = String(el.getAttribute("data-poster-url") || "").trim();
        if (videoUrl) {
          const v = document.createElement("video");
          v.setAttribute("autoplay", "");
          v.setAttribute("muted", "");
          v.setAttribute("loop", "");
          v.setAttribute("playsinline", "");
          v.className = "absolute inset-0 w-full h-full object-cover";
          v.src = videoUrl;
          if (posterUrl) v.setAttribute("poster", posterUrl);
          return v;
        }
        if (posterUrl) {
          const d = document.createElement("div");
          d.className = "absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat";
          d.style.backgroundImage = "url('" + posterUrl.replace(/'/g, "&#39;") + "')";
          return d;
        }
        const d = document.createElement("div");
        d.className = "absolute inset-0 w-full h-full bg-[#1a1a1a]";
        return d;
      }
      function inject(el){
        if (!isVideoLike(el) || alreadyInjected(el)) return;
        ensureRelative(el);
        stripBackgroundImage(el);
        const media = buildMedia(el);
        const wrapper = document.createElement("div");
        wrapper.className = "relative z-10";
        while (el.firstChild) {
          wrapper.appendChild(el.firstChild);
        }
        el.appendChild(media);
        el.appendChild(wrapper);
        try { el.dataset.videoPreviewReady = "1"; } catch {}
      }
      function init(){
        const nodes = Array.prototype.slice.call(document.querySelectorAll("[data-bg-type],[data-fill-type],[data-media]"));
        nodes.forEach(inject);
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
      } else {
        init();
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

  const preferredHeroMediaSrc = pickHeroMediaSrcFromAst(ast);
  if (preferredHeroMediaSrc) {
    fragment = injectHeroMediaByKeyPass(fragment, preferredHeroMediaSrc, "frame:image#1");
    fragment = injectHeroMediaByKeyPass(fragment, preferredHeroMediaSrc, "frame:hero#1");
  }

  const bodyFontCss = primaryFontFamily
    ? `body{ font-family: ${cssFontStack(primaryFontFamily)}; }`
    : "";
  const css = previewCss({ bodyFontCss, designW });

  const iframeSrcdoc = `<!doctype html>
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
  ${videoFillPreviewInit()}
  ${tailwindCdnLoaderScript()}
</body>
</html>`;
  const iframeSrcdocAttr = escapeAttr(iframeSrcdoc);

  return `<!doctype html>
<html class="tw-loading">
<head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Preview – ${escapeHtml(slug)}</title>

  ${googleFonts || ""}
  ${codeMirrorAssets()}

  <style>
html.tw-loading body { opacity: 0; }
html.tw-loading #cmp_root { visibility: hidden; }
${css}
  </style>
</head>

<body class="antialiased bg-white" data-preview-slug="${escapeAttr(slug)}">
  <div id="refine_toast" style="position:fixed;right:16px;bottom:16px;z-index:10040;max-width:420px;display:none;padding:10px 12px;border-radius:10px;background:rgba(15,23,42,.92);color:#fff;font-size:12px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.25);"></div>
  <div id="visual_qa_modal_backdrop" style="display:none;position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.4);align-items:center;justify-content:center;" aria-hidden="true">
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:380px;box-shadow:0 20px 50px rgba(0,0,0,.2);">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:24px;height:24px;border:2px solid rgba(15,23,42,.2);border-top-color:#0f172a;border-radius:50%;animation:visual_qa_spin .8s linear infinite;"></div>
        <strong style="font-size:15px;">Running Visual QA</strong>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">Comparing preview to design and applying class-only patches. This may take 1–2 minutes.</p>
      <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Check the server terminal for progress.</p>
    </div>
  </div>
  <style>@keyframes visual_qa_spin{to{transform:rotate(360deg);}}</style>
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
        <button id="sidebar_toggle" class="stagebtn" type="button" aria-expanded="false">Tools</button>
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
        <span id="analysis_source_badge" class="text-xs px-2 py-1 border rounded-md bg-slate-50 text-slate-600 border-slate-200" title="Visual analysis source">
          analysis: —
        </span>
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
    srcdoc="${iframeSrcdocAttr}"
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

  <aside
    id="sidebar_root"
    aria-hidden="true"
    style="position:fixed;top:68px;right:0;bottom:0;width:min(560px,92vw);background:#fff;border-left:1px solid rgba(148,163,184,.35);box-shadow:-8px 0 24px rgba(15,23,42,.12);transform:translateX(100%);transition:transform .2s ease;z-index:10020;display:flex;flex-direction:column;"
  >
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid rgba(148,163,184,.25);background:#f8fafc;">
      <strong style="font-size:13px;color:#0f172a;">Preview Tools</strong>
      <button id="sidebar_close" class="vpbtn" type="button">Close</button>
    </div>
    <div style="overflow:auto;padding-bottom:18px;">
      <div class="overlay-toolbar" id="export_root" style="border-bottom:1px solid rgba(148,163,184,.25);background:transparent;">
        <div style="padding:12px;display:flex;flex-direction:column;gap:8px;">
          <div class="flex items-center gap-2 flex-wrap" id="export_controls">
            <span class="vpmeta">Export:</span>
            <select id="export_type" class="vpbtn" style="min-width:160px;">
              <option value="">Select folder</option>
            </select>
            <button id="export_btn" class="vpbtn" type="button">Export</button>
          </div>
          <span id="export_components_root" class="vpmeta" title=""></span>
        </div>
      </div>

      <div class="overlay-toolbar" id="editor_root" style="background:transparent;">
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px;">
          <div class="editor-row">
            <button id="editor_select" class="vpbtn" type="button">Select element</button>
            <span class="vpmeta editor-selected" id="editor_selected">No selection</span>
            <input id="editor_node_input" class="editor-input" type="text" placeholder="data-node-id or data-key" />
            <button id="editor_pick" class="vpbtn" type="button">Select by ID</button>
            <button id="editor_clear" class="vpbtn" type="button">Clear</button>
          </div>

          <div class="editor-row">
            <div class="editor-field">
              <label class="vpmeta" for="editor_classes">Classes</label>
              <textarea id="editor_classes" class="editor-textarea" placeholder="Tailwind classes"></textarea>
            </div>
            <div class="editor-field">
              <label class="vpmeta" for="editor_aria_label">aria-label</label>
              <input id="editor_aria_label" class="editor-input" type="text" placeholder="Accessible label" />
            </div>
            <div class="editor-field">
              <label class="vpmeta" for="editor_aria_labelledby">aria-labelledby</label>
              <input id="editor_aria_labelledby" class="editor-input" type="text" placeholder="Element IDs" />
            </div>
            <div class="editor-field">
              <label class="vpmeta" for="editor_aria_describedby">aria-describedby</label>
              <input id="editor_aria_describedby" class="editor-input" type="text" placeholder="Element IDs" />
            </div>
            <div class="editor-field">
              <label class="vpmeta">
                <input id="editor_aria_hidden" type="checkbox" />
                aria-hidden
              </label>
            </div>
          </div>

          <div class="editor-row">
            <button id="editor_apply" class="vpbtn" type="button">Apply & Save</button>
            <span class="vpmeta" id="editor_status"></span>
          </div>

          <div class="editor-row">
            <div class="editor-field" style="flex:1; min-width:260px;">
              <label class="vpmeta">Change log</label>
              <div id="editor_ledger" class="editor-ledger"></div>
            </div>
          </div>

          <div class="editor-row editor-code">
            <div class="editor-field" style="flex:1; min-width:260px;">
              <label class="vpmeta">Stage HTML (read-only)</label>
              <textarea id="editor_html" class="editor-textarea" placeholder="Stage HTML"></textarea>
              <div class="editor-row">
                <button id="editor_html_refresh" class="vpbtn" type="button">Refresh code</button>
                <button id="editor_html_copy" class="vpbtn" type="button">Copy</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>

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
  ${patchesScript()}

  <!-- Viewport sizing + bucket detection (reads window.__RESPONSIVE__) -->
  ${viewportScript({ designW })}

  <div id="pipeline_modal_backdrop" class="modal-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pipeline_modal_title">
      <div class="modal-hd">
        <div>
          <div id="pipeline_modal_title" class="modal-title">Pipeline progress</div>
          <div class="modal-sub">
            Stage: <span class="mono" id="pipeline_stage_label">—</span>
          </div>
        </div>
        <button id="pipeline_modal_close" class="btn2" aria-label="Close">Close</button>
      </div>

      <div class="modal-bd">
        <div class="progress-status" id="pipeline_status">Waiting…</div>
        <div id="pipeline_steps" class="progress-steps"></div>
        <div id="pipeline_log" class="progress-log">Progress log will appear here.</div>
        <div id="pipeline_refine_report" class="progress-log" style="max-height: 180px; overflow: auto;">Refine report will appear here.</div>
        <div class="progress-preview">
          Preview ready: <a id="pipeline_preview_link" href="#" rel="noreferrer">—</a>
        </div>
      </div>

      <div class="modal-ft">
        <div class="progress-status" id="pipeline_status_footer"></div>
        <div class="progress-actions">
          <button id="pipeline_open_preview" class="btn2 primary" disabled>Open preview</button>
          <button id="pipeline_modal_close_footer" class="btn2">Close</button>
        </div>
      </div>
    </div>
  </div>

  <div id="qa_gate_modal_backdrop" class="modal-backdrop" aria-hidden="true">
    <div class="modal qa-gate-modal" role="dialog" aria-modal="true" aria-labelledby="qa_gate_modal_title" style="max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="modal-hd">
        <div>
          <div id="qa_gate_modal_title" class="modal-title">QA Gate – Clean &amp; Verify</div>
          <div class="modal-sub"><span id="qa_gate_slug" class="mono">—</span></div>
        </div>
        <button id="qa_gate_modal_close" class="btn2" aria-label="Close">Close</button>
      </div>
      <div class="modal-bd" style="overflow: auto; flex: 1;">
        <div id="qa_gate_remaining" class="text-sm font-semibold text-slate-800 mb-2 hidden"></div>
        <section class="qa-gate-section">
          <h3 class="text-sm font-semibold text-slate-700 mb-1">0. QA Fix Loop</h3>
          <div id="qa_gate_loop_status" class="progress-log text-sm">—</div>
          <div id="qa_gate_iterations" class="progress-log text-xs whitespace-pre-wrap" style="max-height: 220px; overflow: auto;"></div>
        </section>
        <section class="qa-gate-section">
          <h3 class="text-sm font-semibold text-slate-700 mb-1">1. Audit report (before)</h3>
          <div id="qa_gate_report_before" class="progress-log text-sm"></div>
        </section>
        <section class="qa-gate-section">
          <h3 class="text-sm font-semibold text-slate-700 mb-1">2. Proposed auto-fixes</h3>
          <div id="qa_gate_fixes" class="progress-log text-sm"></div>
        </section>
        <section class="qa-gate-section">
          <h3 class="text-sm font-semibold text-slate-700 mb-1">3. Diff preview</h3>
          <pre id="qa_gate_diff" class="progress-log text-xs whitespace-pre-wrap" style="max-height: 240px; overflow: auto;"></pre>
        </section>
        <section class="qa-gate-section">
          <h3 class="text-sm font-semibold text-slate-700 mb-1">4. Audit report (after)</h3>
          <div id="qa_gate_report_after" class="progress-log text-sm"></div>
        </section>
      </div>
      <div class="modal-ft">
        <div class="progress-actions flex gap-2 flex-wrap">
          <button id="qa_gate_run_loop" class="btn2 primary">Run QA Fix Loop</button>
          <button id="qa_gate_apply" class="btn2 primary">Apply fixes</button>
          <button id="qa_gate_eject" class="btn2">Open preview</button>
          <button id="qa_gate_eject_clean" class="btn2">Eject clean fragment</button>
          <button id="qa_gate_copy_preview_html" class="btn2">Copy Preview HTML</button>
          <button id="qa_gate_copy_clean_html" class="btn2">Copy Clean Fragment</button>
          <button id="qa_gate_back" class="btn2">Back</button>
          <button id="qa_gate_export" class="btn2">Export report</button>
          <button id="qa_gate_modal_close_footer" class="btn2">Close</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function(){
      const allowed = ["generate", "codeit", "improve"];
      const qs = new URLSearchParams(location.search);
      const raw = String(qs.get("stage") || "generate").toLowerCase();
      let activeStage = allowed.includes(raw) ? raw : "generate";
      const buttons = Array.prototype.slice.call(document.querySelectorAll("[data-stage-btn]"));
      const setStageActive = (stage, syncUrl = true) => {
        const next = allowed.includes(String(stage || "").toLowerCase())
          ? String(stage).toLowerCase()
          : activeStage;
        activeStage = next;
        buttons.forEach((btn) => {
          const s = String(btn.getAttribute("data-stage") || "").toLowerCase();
          btn.dataset.active = s === activeStage ? "1" : "0";
        });
        if (syncUrl) {
          const params = new URLSearchParams(location.search);
          params.set("stage", activeStage);
          const nextUrl = location.pathname + "?" + params.toString() + location.hash;
          try {
            history.replaceState(null, "", nextUrl);
          } catch (_) {}
        }
      };


      const stageLabels = {
        generate: "Generate",
        codeit: "Code it",
        improve: "Improve",
      };

      const STAGE_STEPS = {
        generate: [
          "Preparing AST…",
          "Generating HTML…",
          "Repairing Tailwind classes…",
          "Running validation…",
          "Rendering screenshot…",
          "Sending payload…",
          "Running Visual QA…",
          "Improving fidelity…",
          "Done.",
        ],
        codeit: [
          "Loading artifact.generate.json…",
          "Preparing contract runner…",
          "Running validation (post-clean)…",
          "Running Evaluate (regression gate)…",
          "Writing artifact.codeit.json…",
          "Done.",
        ],
        /* codeit contract steps are injected from log (Contract: <id>…) */
        improve: [
          "Loading artifact.codeit.json…",
          "Running Evaluate (find offenders)…",
          "Selecting top offenders (N=25)…",
          "Generating patch plan…",
          "Validating patch plan (bounded ops only)…",
          "Applying patches…",
          "Running Evaluate (verify improvement)…",
          "Accepting patches (score gate)…",
          "Writing artifact.improve.json…",
          "Done.",
        ],
      };

      const modalBackdrop = document.getElementById("pipeline_modal_backdrop");
      const modalClose = document.getElementById("pipeline_modal_close");
      const modalCloseFooter = document.getElementById("pipeline_modal_close_footer");
      const modalTitle = document.getElementById("pipeline_modal_title");
      const stageLabel = document.getElementById("pipeline_stage_label");
      const statusEl = document.getElementById("pipeline_status");
      const statusFooter = document.getElementById("pipeline_status_footer");
      const stepsEl = document.getElementById("pipeline_steps");
      const logEl = document.getElementById("pipeline_log");
      const refineReportEl = document.getElementById("pipeline_refine_report");
      const previewLink = document.getElementById("pipeline_preview_link");
      const openPreviewBtn = document.getElementById("pipeline_open_preview");

      let stepMap = new Map();
      let progressTimer = null;
      let progressIndex = 0;
      let progressStage = "";

      const slug = String(window.__CURRENT_PREVIEW_SLUG__ || (document.body && document.body.getAttribute("data-preview-slug")) || "").trim();

      const setModalOpen = (isOpen) => {
        if (!modalBackdrop) return;
        modalBackdrop.dataset.open = isOpen ? "1" : "0";
        modalBackdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
      };

      const setStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg || "";
        if (statusFooter) statusFooter.textContent = msg || "";
      };

      const setLog = (text) => {
        if (logEl) logEl.textContent = text || "";
      };

      const setPreviewUrl = (url) => {
        if (previewLink) {
          previewLink.textContent = url || "—";
          previewLink.href = url || "#";
        }
        if (openPreviewBtn) {
          openPreviewBtn.disabled = !url;
          openPreviewBtn.dataset.url = url || "";
        }
      };
      const fallbackPreviewUrl = () => {
        const targetSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        return targetSlug ? ("/preview/" + encodeURIComponent(targetSlug)) : "";
      };
      const formatNum = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return "—";
        return n.toFixed(4);
      };
      let latestRefineResult = null;
      let refineOffenderLayer = null;
      const esc = (s) =>
        String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const normalizeBucket = (b) => {
        const v = String(b || "").toLowerCase();
        return (v === "desktop" || v === "tablet" || v === "mobile") ? v : "";
      };
      const pickWorstBucketFromScores = (scoreMap) => {
        const entries = ["desktop", "tablet", "mobile"]
          .map((b) => ({ bucket: b, diff: Number(scoreMap?.[b]?.diffRatio) }))
          .filter((x) => Number.isFinite(x.diff));
        if (!entries.length) return "";
        entries.sort((a, b) => b.diff - a.diff);
        return entries[0].bucket;
      };
      const ensureRefineOffenderLayer = () => {
        if (refineOffenderLayer && refineOffenderLayer.isConnected) return refineOffenderLayer;
        const layer = document.createElement("div");
        layer.id = "refine_offenders_overlay";
        layer.style.position = "fixed";
        layer.style.left = "0";
        layer.style.top = "0";
        layer.style.width = "100vw";
        layer.style.height = "100vh";
        layer.style.pointerEvents = "none";
        layer.style.zIndex = "70";
        document.body.appendChild(layer);
        refineOffenderLayer = layer;
        return layer;
      };
      const clearRefineOffenderBoxes = () => {
        const layer = ensureRefineOffenderLayer();
        layer.innerHTML = "";
      };
      const drawRefineOffenderBoxes = (result, bucketInput) => {
        const layer = ensureRefineOffenderLayer();
        layer.innerHTML = "";
        const iterations = Array.isArray(result?.iterations) ? result.iterations : [];
        const latest = iterations.length ? iterations[iterations.length - 1] : null;
        if (!latest) return;
        const bucket = normalizeBucket(bucketInput) || pickWorstBucketFromScores(latest?.after || latest?.before || {});
        if (!bucket) return;
        const offenders = Array.isArray(latest?.offenders?.[bucket]) ? latest.offenders[bucket] : [];
        offenders.slice(0, 12).forEach((off, idx) => {
          const bb = off?.bbox || {};
          const x = Number(bb.x);
          const y = Number(bb.y);
          const w = Number(bb.w);
          const h = Number(bb.h);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
          if (w <= 0 || h <= 0) return;
          const box = document.createElement("div");
          box.style.position = "fixed";
          box.style.left = Math.max(0, Math.round(x)) + "px";
          box.style.top = Math.max(0, Math.round(y)) + "px";
          box.style.width = Math.max(2, Math.round(w)) + "px";
          box.style.height = Math.max(2, Math.round(h)) + "px";
          box.style.border = idx < 3 ? "2px solid rgba(220,38,38,.95)" : "1px solid rgba(234,88,12,.9)";
          box.style.background = "rgba(239,68,68,.08)";
          box.style.boxSizing = "border-box";
          box.style.borderRadius = "2px";
          const label = document.createElement("div");
          label.textContent = "#" + (idx + 1) + " " + Math.round(Number(off?.pixels || 0)) + "px";
          label.style.position = "absolute";
          label.style.left = "0";
          label.style.top = "-18px";
          label.style.fontSize = "10px";
          label.style.lineHeight = "1";
          label.style.padding = "2px 4px";
          label.style.color = "#fff";
          label.style.background = "rgba(15,23,42,.85)";
          label.style.whiteSpace = "nowrap";
          box.appendChild(label);
          layer.appendChild(box);
        });
      };
      const renderRefineReport = (result) => {
        if (!refineReportEl) return;
        const iterations = Array.isArray(result?.iterations) ? result.iterations : [];
        if (!iterations.length) {
          latestRefineResult = null;
          clearRefineOffenderBoxes();
          refineReportEl.textContent = "Refine report will appear here.";
          return;
        }
        latestRefineResult = result;
        const rows = [];
        iterations.slice(-6).forEach((it) => {
          const idx = Number(it?.iteration || it?.iter || 0);
          const buckets = ["desktop", "tablet", "mobile"].filter(
            (b) => (it?.before && it.before[b]) || (it?.after && it.after[b])
          );
          const bucketBits = buckets.map((b) => {
            const beforeObj = it?.before?.[b] || {};
            const afterObj = it?.after?.[b] || {};
            const beforeDiff = formatNum(beforeObj?.diffRatio);
            const afterDiff = formatNum(afterObj?.diffRatio);
            const beforeLayout = formatNum(beforeObj?.layoutDiffRatio ?? beforeObj?.diffRatio);
            const afterLayout = formatNum(afterObj?.layoutDiffRatio ?? afterObj?.diffRatio);
            const dx = Number(afterObj?.bestDx ?? beforeObj?.bestDx ?? 0);
            const dy = Number(afterObj?.bestDy ?? beforeObj?.bestDy ?? 0);
            const mode = String(
              afterObj?.failureMode ||
              beforeObj?.failureMode ||
              it?.failureMode ||
              "none"
            );
            return (
              "<span><strong>" + esc(b) + "</strong>: " +
              "diff " + esc(beforeDiff) + " -> " + esc(afterDiff) +
              " | layout " + esc(beforeLayout) + " -> " + esc(afterLayout) +
              " | dx/dy " + esc(dx) + "/" + esc(dy) +
              " | mode " + esc(mode) +
              "</span>"
            );
          });
          const accepted = it?.accepted === true || it?.pass === true;
          const rolled = it?.rolledBack === true;
          rows.push(
            "<div style='padding:6px 0;border-top:1px solid rgba(148,163,184,.2)'>" +
            "<div><strong>iter " + esc(idx) + "</strong> " + (accepted ? "accepted" : "rejected") + (rolled ? " (rolled back)" : "") + "</div>" +
            "<div><strong>metric:</strong> " + esc(it?.activeMetric || it?.metricUsed || "diffRatio") + "</div>" +
            "<div style='display:flex;gap:10px;flex-wrap:wrap'>" + (bucketBits.join("") || "—") + "</div>" +
            "</div>"
          );
        });
        const latest = iterations[iterations.length - 1] || {};
        const chosenBucket = normalizeBucket(activeBucket()) || pickWorstBucketFromScores(latest?.after || latest?.before || {});
        const art = latest?.artifacts || {};
        const afterArt = art?.after?.[chosenBucket] || {};
        const beforeArt = art?.before?.[chosenBucket] || {};
        const ts = Date.now();
        const img = (src, label) =>
          src
            ? "<a href='" + esc(src) + "' target='_blank' rel='noreferrer' style='display:inline-flex;flex-direction:column;gap:4px'>" +
              "<span>" + esc(label) + "</span><img src='" + esc(src + "?ts=" + ts) + "' style='width:120px;height:68px;object-fit:cover;border:1px solid rgba(148,163,184,.35);border-radius:4px' /></a>"
            : "";
        refineReportEl.innerHTML =
          "<div><strong>Stopped:</strong> " + esc(result?.stoppedReason || "running") + " | <strong>pass threshold:</strong> " + esc(formatNum(result?.passDiffRatio || 0)) + "</div>" +
          rows.join("") +
          "<div style='padding-top:8px;border-top:1px solid rgba(148,163,184,.3)'>" +
          "<div><strong>Latest artifacts (" + esc(chosenBucket || "n/a") + ")</strong></div>" +
          "<div style='display:flex;gap:10px;flex-wrap:wrap;margin-top:6px'>" +
          img(beforeArt?.render, "before render") +
          img(beforeArt?.diff, "before diff") +
          img(afterArt?.render, "after render") +
          img(afterArt?.diff, "after diff") +
          "</div></div>";
        drawRefineOffenderBoxes(result, chosenBucket);
      };
      const buildPreviewUrl = (stage) => {
        const params = new URLSearchParams(location.search);
        params.set("stage", String(stage || "improve").toLowerCase());
        return location.pathname + "?" + params.toString() + location.hash;
      };

      const renderSteps = (stage) => {
        if (!stepsEl) return;
        stepMap = new Map();
        stepsEl.innerHTML = "";
        const steps = STAGE_STEPS[stage] || [];
        steps.forEach((label, index) => {
          const el = document.createElement("div");
          el.className = "progress-step";
          el.dataset.state = index === 0 ? "active" : "pending";
          el.dataset.label = label;
          el.textContent = label;
          stepMap.set(label, el);
          stepsEl.appendChild(el);
        });
      };

      const updateStepText = (el) => {
        if (!el) return;
        const label = el.dataset.label || el.textContent || "";
        const state = el.dataset.state || "pending";
        if (state === "done") {
          el.textContent = "✓ " + label;
        } else {
          el.textContent = label;
        }
      };

      const setStepState = (label, state) => {
        const el = stepMap.get(label);
        if (!el) return;
        el.dataset.state = state;
        updateStepText(el);
      };

      const markStepsFromLog = (stage, logText) => {
        const steps = STAGE_STEPS[stage] || [];
        let matched = false;
        steps.forEach((label) => {
          const el = stepMap.get(label);
          if (!el) return;
          if (logText.includes(label)) {
            el.dataset.state = "done";
            updateStepText(el);
            matched = true;
          }
        });
        if (!matched && logText) {
          stepMap.forEach((el) => {
            el.dataset.state = "done";
            updateStepText(el);
          });
        }
        if (stage === "codeit" && stepsEl && logText) {
          injectCodeitContractStepsFromLog(logText);
        }
      };

      const injectCodeitContractStepsFromLog = (logText) => {
        const re = /✓\\s+(Contract: [^\\n]+)/g;
        const labels = [];
        let m;
        while ((m = re.exec(logText)) !== null) labels.push(m[1]);
        if (!labels.length) return;
        const preparingLabel = "Preparing contract runner…";
        const preparingEl = Array.prototype.find.call(
          stepsEl.children,
          (el) => (el.dataset.label || "") === preparingLabel
        );
        if (!preparingEl) return;
        let insertAfter = preparingEl;
        labels.forEach((label) => {
          if (stepMap.get(label)) return;
          const el = document.createElement("div");
          el.className = "progress-step";
          el.dataset.state = "done";
          el.dataset.label = label;
          el.textContent = "✓ " + label;
          stepMap.set(label, el);
          insertAfter.parentNode.insertBefore(el, insertAfter.nextSibling);
          insertAfter = el;
        });
      };

      const startProgress = (stage) => {
        const steps = STAGE_STEPS[stage] || [];
        progressIndex = 0;
        progressStage = stage;
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        if (!steps.length) return;
        steps.forEach((label, index) => {
          setStepState(label, index === 0 ? "active" : "pending");
        });
        progressTimer = setInterval(() => {
          if (progressStage !== stage) return;
          const currentLabel = steps[progressIndex];
          if (currentLabel) {
            setStepState(currentLabel, "done");
          }
          progressIndex += 1;
          const nextLabel = steps[progressIndex];
          if (nextLabel) {
            setStepState(nextLabel, "active");
          } else {
            clearInterval(progressTimer);
            progressTimer = null;
          }
        }, 900);
      };

      const stopProgress = () => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };

      const appendLog = (line) => {
        const next = String(line || "").trim();
        if (!next) return;
        const prev = logEl ? String(logEl.textContent || "").trim() : "";
        setLog(prev ? (prev + "\\n" + next) : next);
      };

      const runGeneratePostSteps = async () => {
        const currentSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!currentSlug) return;
        appendLog("[post-generate] starting Visual QA + Improve fidelity…");

        setStepState("Running Visual QA…", "active");
        setStatus("Running Visual QA…");
        try {
          const qaResp = await fetch("/api/visual-qa/" + encodeURIComponent(currentSlug), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "report",
              reportOnly: true,
              passDiffRatio: 0.02,
              maxIterations: 1,
              patchBudget: 1,
            }),
          });
          const qaOut = await qaResp.json().catch(() => ({}));
          if (!qaResp.ok) {
            appendLog("[post-generate][visual-qa] failed: " + String(qaOut?.error || qaResp.status));
          } else {
            appendLog(
              "[post-generate][visual-qa] " +
                String(qaOut?.stoppedReason || "done") +
                " (iterations=" +
                String(qaOut?.iterations ?? 0) +
                ")"
            );
          }
        } catch (e) {
          appendLog("[post-generate][visual-qa] error: " + String(e?.message || e));
        } finally {
          setStepState("Running Visual QA…", "done");
        }

        setStepState("Improving fidelity…", "active");
        setStatus("Running Improve fidelity…");
        try {
          const improveResp = await fetch("/api/build-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug: currentSlug,
              refineMode: "visual",
              autoFix: 1,
              maxIterations: 5,
              patchBudget: 10,
            }),
          });
          const improveOut = await improveResp.json().catch(() => ({}));
          if (!improveResp.ok || !improveOut?.ok) {
            appendLog("[post-generate][improve] failed: " + String(improveOut?.error || improveResp.status));
          } else {
            const patches = Number(improveOut?.qa?.totalPatchCount || 0);
            appendLog(
              "[post-generate][improve] " +
                String(improveOut?.qa?.stoppedReason || "done") +
                " (patches=" +
                String(patches) +
                ")"
            );
          }
        } catch (e) {
          appendLog("[post-generate][improve] error: " + String(e?.message || e));
        } finally {
          setStepState("Improving fidelity…", "done");
        }
        appendLog("[post-generate] completed Visual QA + Improve fidelity.");
      };

      const runPipelineStage = async (stage) => {
        setStageActive(stage, true);
        if (!modalBackdrop) {
          const next = new URLSearchParams(location.search);
          next.set("stage", stage);
          const nextUrl = location.pathname + "?" + next.toString() + location.hash;
          location.href = nextUrl;
          return;
        }

        const label = stageLabels[stage] || stage;
        setModalOpen(true);
        if (modalTitle) modalTitle.textContent = label + " progress";
        if (stageLabel) stageLabel.textContent = label;
        setStatus("Running " + label + "…");
        setLog("Running pipeline…");
        setPreviewUrl("");
        renderSteps(stage);
        startProgress(stage);

        try {
          const response = await fetch("/api/pipeline/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, stage }),
          });

          const payload = await response.json().catch(() => null);
          const logText = String(payload?.log || payload?.error || "");
          setLog(logText || "No log output.");
          stopProgress();
          markStepsFromLog(stage, logText);

          if (payload?.ok) {
            const previewUrl =
              payload.previewUrl ||
              (location.pathname +
                "?stage=" +
                encodeURIComponent(stage) +
                location.hash);
            if (stage === "generate") {
              await runGeneratePostSteps();
            }
            setStatus("Done. Review output in this modal, then use Open preview.");
            setPreviewUrl(previewUrl);
            setStepState("Done.", "done");
            setStageActive(stage, true);
          } else {
            setStatus(payload?.error || "Pipeline failed.");
          }
        } catch (error) {
          setStatus("Pipeline failed.");
          setLog(String(error?.message || error));
          stopProgress();
        }
      };

      setStageActive(activeStage, false);
      buttons.forEach((btn) => {
        const stage = String(btn.getAttribute("data-stage") || "").toLowerCase();
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          if (!stage) return;
          runPipelineStage(stage);
        });
      });

      if (modalClose) modalClose.addEventListener("click", () => setModalOpen(false));
      if (modalCloseFooter) modalCloseFooter.addEventListener("click", () => setModalOpen(false));
      if (modalBackdrop) {
        modalBackdrop.addEventListener("click", (event) => {
          if (event.target === modalBackdrop) setModalOpen(false);
        });
      }

      if (openPreviewBtn) {
        openPreviewBtn.addEventListener("click", () => {
          const url = String(openPreviewBtn.dataset.url || "");
          if (!url) return;
          location.href = url;
        });
      }

      const refineBtn = document.getElementById("refine_ai");
      const refineAdvancedToggleBtn = document.getElementById("refine_advanced_toggle");
      const refineAdvancedPanel = document.getElementById("refine_advanced_panel");
      const refineDesktopBtn = document.getElementById("refine_desktop");
      const refineTabletBtn = document.getElementById("refine_tablet");
      const refineMobileBtn = document.getElementById("refine_mobile");
      const refineAllBtn = document.getElementById("refine_all");
      const refineStructureBtn = document.getElementById("refine_structure");
      const refineUntilPassBtn = document.getElementById("refine_until_pass");
      const refineUndoBtn = document.getElementById("refine_undo");
      const refineStopBtn = document.getElementById("refine_stop");
      const refineItersInput = document.getElementById("refine_iters");
      const refineTopInput = document.getElementById("refine_top");
      const refinePassInput = document.getElementById("refine_pass");
      function activeBucket() {
        const cmp = document.getElementById("cmp_root");
        return String(cmp?.dataset?.bucket || "desktop").toLowerCase();
      }
      function parsePassDiffRatioInput(v, fallback = 0.02) {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(0.03, Math.max(0.01, n));
      }

      function setRefineControlsDisabled(disabled) {
        const nodes = [
          refineBtn,
          refineDesktopBtn,
          refineTabletBtn,
          refineMobileBtn,
          refineAllBtn,
          refineStructureBtn,
          refineUntilPassBtn,
          refineUndoBtn,
        ];
        nodes.forEach((n) => { if (n) n.disabled = !!disabled; });
        if (refineStopBtn) refineStopBtn.disabled = !disabled;
      }
      function setAdvancedOpen(open) {
        const isOpen = !!open;
        if (refineAdvancedPanel) refineAdvancedPanel.style.display = isOpen ? "" : "none";
        if (refineAdvancedToggleBtn) {
          refineAdvancedToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
          refineAdvancedToggleBtn.textContent = isOpen ? "Advanced ▾" : "Advanced ▸";
        }
      }
      setAdvancedOpen(false);

      window.reloadCurrentPreview = async function(opts = {}) {
        const preserveOverlayState = opts.preserveOverlayState !== false;
        const slugCurrent = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!slugCurrent) throw new Error("reloadCurrentPreview: missing slug");
        const cmpRoot = document.getElementById("cmp_root");
        const currentBucket = String(opts.bucket || cmpRoot?.dataset?.bucket || "desktop").toLowerCase();
        const contentLayer = document.querySelector("#cmp_root .content-layer");
        if (!contentLayer) throw new Error("reloadCurrentPreview: content-layer missing");

        const state = {};
        const ovEnabled = document.getElementById("ov_enabled");
        const ovOpacity = document.getElementById("ov_opacity");
        const ovDiff = document.getElementById("ov_diff");
        if (preserveOverlayState) {
          state.enabled = ovEnabled ? !!ovEnabled.checked : null;
          state.opacity = ovOpacity ? String(ovOpacity.value || "50") : null;
          state.diff = ovDiff ? !!ovDiff.checked : null;
        }

        const url =
          "/preview/" +
          encodeURIComponent(slugCurrent) +
          "?embed=1&toolbar=0" +
          "&ts=" +
          Date.now();
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("reloadCurrentPreview: fetch failed");
        const html = await response.text();
        if (!html || !html.trim()) throw new Error("reloadCurrentPreview: empty embed html");

        const parser = new DOMParser();
        const parsed = parser.parseFromString("<div>" + html + "</div>", "text/html");
        const incomingLayer = parsed.querySelector(".content-layer");
        const currentIframe = document.getElementById("vp_iframe");
        const incomingIframe = incomingLayer ? incomingLayer.querySelector("#vp_iframe") : null;
        const incomingSrcdoc = incomingIframe ? String(incomingIframe.getAttribute("srcdoc") || "") : "";

        // Preserve the existing iframe node so viewport/resize listeners stay bound.
        if (currentIframe && incomingSrcdoc) {
          const incomingStyle = incomingIframe ? String(incomingIframe.getAttribute("style") || "") : "";
          if (incomingStyle) currentIframe.setAttribute("style", incomingStyle);
          currentIframe.setAttribute("srcdoc", incomingSrcdoc);
        } else if (incomingLayer) {
          contentLayer.innerHTML = incomingLayer.innerHTML;
        } else {
          // Fallback only if embed payload shape changed.
          contentLayer.innerHTML = html;
        }
        if (cmpRoot) cmpRoot.dataset.bucket = currentBucket;

        if (typeof window.applyPatchesForCurrentSlug === "function") {
          await window.applyPatchesForCurrentSlug();
        } else if (typeof window.__applyPatchesForCurrentSlug__ === "function") {
          await window.__applyPatchesForCurrentSlug__();
        }

        if (preserveOverlayState) {
          if (ovEnabled && state.enabled != null) ovEnabled.checked = !!state.enabled;
          if (ovOpacity && state.opacity != null) ovOpacity.value = state.opacity;
          if (ovDiff && state.diff != null) ovDiff.checked = !!state.diff;
          if (ovEnabled) ovEnabled.dispatchEvent(new Event("change", { bubbles: true }));
          if (ovOpacity) ovOpacity.dispatchEvent(new Event("input", { bubbles: true }));
          if (ovDiff) ovDiff.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (typeof window.__previewViewportSync === "function") {
          window.__previewViewportSync();
        }
      };
      window.__reloadCurrentPreview__ = window.reloadCurrentPreview;

      const prevBucketReloadHook =
        typeof window.__onPreviewBucketChange === "function" ? window.__onPreviewBucketChange : null;
      window.__onPreviewBucketChange = function(payload) {
        try {
          if (prevBucketReloadHook) prevBucketReloadHook(payload);
        } finally {
          const b = String(payload?.bucket || activeBucket()).toLowerCase();
          window.reloadCurrentPreview({ bucket: b, preserveOverlayState: true })
            .then(() => {
              if (latestRefineResult) drawRefineOffenderBoxes(latestRefineResult, b);
            })
            .catch(() => {});
        }
      };

      let currentRefineJobId = "";
      let refinePollTimer = null;
      let refineEventSource = null;
      let lastSeenIter = 0;
      let toastTimer = null;
      let refineWatchdogTimer = null;
      const REFINE_WATCHDOG_STEP_MS = 180000;
      const REFINE_WATCHDOG_MAX_MS = 1800000;
      let refineStartedAtMs = 0;

      function showRefineToast(message, kind) {
        const toast = document.getElementById("refine_toast");
        if (!toast) return;
        const msg = String(message || "").trim();
        if (!msg) return;
        toast.textContent = msg;
        toast.style.display = "block";
        toast.style.background =
          kind === "error"
            ? "rgba(176,0,32,.94)"
            : kind === "success"
              ? "rgba(10,122,47,.94)"
              : "rgba(15,23,42,.92)";
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toast.style.display = "none";
        }, 1900);
      }

      function stopPolling() {
        if (refineEventSource) {
          try { refineEventSource.close(); } catch {}
          refineEventSource = null;
        }
        if (refinePollTimer) {
          clearInterval(refinePollTimer);
          refinePollTimer = null;
        }
        if (refineWatchdogTimer) {
          clearTimeout(refineWatchdogTimer);
          refineWatchdogTimer = null;
        }
        refineStartedAtMs = 0;
      }

      function clearRefineWatchdog() {
        if (refineWatchdogTimer) {
          clearTimeout(refineWatchdogTimer);
          refineWatchdogTimer = null;
        }
      }

      function unlockRefineControlsWithTimeout() {
        stopPolling();
        setRefineControlsDisabled(false);
        currentRefineJobId = "";
        setStatus("Refine timed out. Controls unlocked.");
        showRefineToast("Refine timed out", "error");
      }

      function armRefineWatchdog(jobId, onDone) {
        const safeJobId = String(jobId || "").trim();
        if (!safeJobId) return;
        clearRefineWatchdog();
        refineWatchdogTimer = setTimeout(async () => {
          if (!safeJobId || safeJobId !== String(currentRefineJobId || "").trim()) return;
          const elapsed = Date.now() - Number(refineStartedAtMs || Date.now());
          if (elapsed >= REFINE_WATCHDOG_MAX_MS) {
            unlockRefineControlsWithTimeout();
            return;
          }
          try {
            const r = await fetch("/api/refine-status/" + encodeURIComponent(safeJobId), { cache: "no-store" });
            const payload = await r.json().catch(() => null);
            const job = payload && payload.job ? payload.job : null;
            const status = String(job?.status || "");
            if (status === "running") {
              setStatus("Refining… still running (" + Math.round(elapsed / 1000) + "s)");
              armRefineWatchdog(safeJobId, onDone);
              return;
            }
            if (status === "done" || status === "failed" || status === "cancelled") {
              stopPolling();
              setRefineControlsDisabled(false);
              currentRefineJobId = "";
              if (typeof onDone === "function") onDone(job);
              return;
            }
          } catch (_) {}
          // Unknown transient state; keep waiting instead of false timeout.
          armRefineWatchdog(safeJobId, onDone);
        }, REFINE_WATCHDOG_STEP_MS);
      }

      async function applyIterProgress(iter, bucket, beforeDiff, afterDiff, message) {
        const safeIter = Number(iter || 0);
        if (safeIter <= lastSeenIter) return;
        lastSeenIter = safeIter;
        const b = normalizeBucket(bucket) || activeBucket() || "desktop";
        const hasDiff = Number.isFinite(Number(beforeDiff)) && Number.isFinite(Number(afterDiff));
        const statusMsg =
          "Refining… iter " +
          safeIter +
          " (" +
          String(message || "running") +
          ")" +
          (hasDiff ? " diff " + Number(beforeDiff).toFixed(4) + " -> " + Number(afterDiff).toFixed(4) : "");
        setStatus(statusMsg);
        showRefineToast(
          "Refining… iter " + safeIter + (hasDiff ? " (" + b + ") " + Number(beforeDiff).toFixed(4) + " -> " + Number(afterDiff).toFixed(4) : ""),
          "info"
        );
        try {
          await window.reloadCurrentPreview({ bucket: b, preserveOverlayState: true });
        } catch (e) {
          setStatus("Preview reload failed: " + String(e?.message || e));
          showRefineToast("Preview reload failed", "error");
        }
      }

      function monitorRefineJobSse(jobId, onDone) {
        stopPolling();
        refineStartedAtMs = Date.now();
        armRefineWatchdog(jobId, onDone);

        if (typeof EventSource === "undefined") {
          monitorRefineJob(jobId, onDone);
          return;
        }

        refineEventSource = new EventSource("/api/refine/stream/" + encodeURIComponent(jobId));
        refineEventSource.addEventListener("iter", (event) => {
          let data = null;
          try { data = JSON.parse(String(event?.data || "{}")); } catch {}
          if (!data) return;
          armRefineWatchdog(jobId, onDone);
          applyIterProgress(
            Number(data.iter || 0),
            String(data.bucket || ""),
            Number(data.diffRatioBefore),
            Number(data.diffRatioAfter),
            String(data.message || "running")
          );
        });

        refineEventSource.addEventListener("done", async (event) => {
          stopPolling();
          setRefineControlsDisabled(false);
          currentRefineJobId = "";
          let data = null;
          try { data = JSON.parse(String(event?.data || "{}")); } catch {}
          const result = data?.final || {};
          setPreviewUrl(result.previewUrl || fallbackPreviewUrl());
          renderRefineReport(result);
          if (data?.ok) {
            setStatus("Refine done.");
            showRefineToast("Refine complete", "success");
            try {
              await window.reloadCurrentPreview({ preserveOverlayState: true });
            } catch (e) {
              setStatus("Preview reload failed: " + String(e?.message || e));
              showRefineToast("Preview reload failed", "error");
            }
          } else if (data?.status === "cancelled") {
            setStatus("Refine cancelled.");
            showRefineToast("Refine stopped", "info");
          } else {
            setStatus(String(data?.error || "Refine failed."));
            showRefineToast("Refine failed", "error");
          }
          setLog(JSON.stringify(result || data || {}, null, 2));
          if (typeof onDone === "function") onDone({ status: data?.status || "done", result });
        });

        refineEventSource.onerror = () => {
          // If SSE drops early, fallback to status polling.
          if (Date.now() - startedAt > 2000) {
            stopPolling();
            monitorRefineJob(jobId, onDone);
          }
        };
      }

      async function startRefineJob(startUrl, payload, label) {
        const targetSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!targetSlug) {
          alert("No slug available for refine.");
          return null;
        }
        if (modalBackdrop) {
          setModalOpen(true);
          if (modalTitle) modalTitle.textContent = label + " progress";
          if (stageLabel) stageLabel.textContent = label;
          setStatus("Refining…");
          setLog("Starting " + label + " job…");
        }
        setPreviewUrl(fallbackPreviewUrl());
        renderRefineReport(null);
        setRefineControlsDisabled(true);
        stopPolling();
        try {
          const response = await fetch(startUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok || !data?.jobId) {
            setRefineControlsDisabled(false);
            currentRefineJobId = "";
            setStatus((data && data.error) ? data.error : "Failed to start refine job.");
            setLog(JSON.stringify(data || {}, null, 2));
            showRefineToast("Failed to start refine", "error");
            return null;
          }
          currentRefineJobId = String(data.jobId);
          lastSeenIter = 0;
          return currentRefineJobId;
        } catch (e) {
          setRefineControlsDisabled(false);
          currentRefineJobId = "";
          setStatus("Failed to start refine job.");
          setLog(String(e?.message || e));
          showRefineToast("Failed to start refine", "error");
          return null;
        }
      }

      async function monitorRefineJob(jobId, onDone) {
        stopPolling();
        const startedAt = Date.now();
        refineStartedAtMs = startedAt;
        armRefineWatchdog(jobId, onDone);
        refinePollTimer = setInterval(async () => {
          try {
            const r = await fetch("/api/refine-status/" + encodeURIComponent(jobId), { cache: "no-store" });
            const payload = await r.json().catch(() => null);
            armRefineWatchdog(jobId, onDone);
            if (!r.ok || !payload?.ok || !payload?.job) {
              // Missing/invalid status must not lock the UI.
              if (Date.now() - startedAt > 3000) {
                stopPolling();
                setRefineControlsDisabled(false);
                currentRefineJobId = "";
                setStatus("Refine status unavailable. Controls unlocked.");
                showRefineToast("Status unavailable", "error");
              }
              return;
            }
            const job = payload.job;
            const iter = Number(job.iter || 0);
            const result = job.result || {};
            if (result && typeof result === "object") {
              setPreviewUrl(result.previewUrl || fallbackPreviewUrl());
              renderRefineReport(result);
            } else {
              setPreviewUrl(fallbackPreviewUrl());
            }
            if (iter > lastSeenIter) {
              lastSeenIter = iter;
              const latest = Array.isArray(result?.iterations) ? result.iterations[result.iterations.length - 1] : null;
              const currentBucket =
                normalizeBucket(activeBucket()) ||
                pickWorstBucketFromScores(latest?.after || latest?.before || {}) ||
                "desktop";
              const beforeObj = latest?.before?.[currentBucket] || latest?.scoreBefore || {};
              const afterObj = latest?.after?.[currentBucket] || latest?.scoreAfter || {};
              const beforeDiff = Number(beforeObj?.diffRatio);
              const afterDiff = Number(afterObj?.diffRatio);
              const hasDiff = Number.isFinite(beforeDiff) && Number.isFinite(afterDiff);
              const statusMsg =
                "Refining… iter " +
                iter +
                " (" +
                (job.message || "running") +
                ")" +
                (hasDiff ? " diff " + beforeDiff.toFixed(4) + " -> " + afterDiff.toFixed(4) : "");
              setStatus(statusMsg);
              showRefineToast(
                "Refining… iter " + iter + (hasDiff ? " (" + currentBucket + ") " + beforeDiff.toFixed(4) + " -> " + afterDiff.toFixed(4) : ""),
                "info"
              );
              try {
                await window.reloadCurrentPreview({ preserveOverlayState: true });
              } catch (e) {
                setStatus("Preview reload failed: " + String(e?.message || e));
                showRefineToast("Preview reload failed", "error");
              }
            }
            if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
              stopPolling();
              setRefineControlsDisabled(false);
              currentRefineJobId = "";
              const result = job.result || {};
              if (job.status === "done") {
                setStatus("Refine done.");
                setPreviewUrl(result.previewUrl || fallbackPreviewUrl());
                renderRefineReport(result);
                showRefineToast("Refine complete", "success");
                try {
                  await window.reloadCurrentPreview({ preserveOverlayState: true });
                } catch (e) {
                  setStatus("Preview reload failed: " + String(e?.message || e));
                  showRefineToast("Preview reload failed", "error");
                }
              } else if (job.status === "cancelled") {
                setStatus("Refine cancelled.");
                showRefineToast("Refine stopped", "info");
              } else {
                setStatus(job.error || "Refine failed.");
                showRefineToast("Refine failed", "error");
              }
              setLog(JSON.stringify(result || { error: job.error || null, status: job.status }, null, 2));
              if (typeof onDone === "function") onDone(job);
            }
          } catch (e) {
            if (Date.now() - startedAt > 3000) {
              stopPolling();
              setRefineControlsDisabled(false);
              currentRefineJobId = "";
              setStatus("Refine polling failed. Controls unlocked.");
              setLog(String(e?.message || e));
              showRefineToast("Polling failed", "error");
            }
          }
        }, 700);
      }

      async function runRefine(bucket) {
        const targetSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!targetSlug) return;
        const maxIters = Math.max(1, Math.min(8, Number(refineItersInput?.value || 3)));
        const topOffenders = Math.max(1, Math.min(40, Number(refineTopInput?.value || 12)));
        const passDiffRatio = parsePassDiffRatioInput(refinePassInput?.value, 0.02);
        const jobId = await startRefineJob(
          "/api/refine/" + encodeURIComponent(targetSlug),
          { bucket, maxIters, topOffenders, passDiffRatio, dryRun: false },
          "AI refine"
        );
        if (jobId) monitorRefineJobSse(jobId);
      }

      async function runStructureRefine(bucket) {
        const targetSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!targetSlug) return;
        const maxIters = Math.max(1, Math.min(4, Number(refineItersInput?.value || 2)));
        const topOffenders = Math.max(1, Math.min(40, Number(refineTopInput?.value || 10)));
        const passDiffRatio = parsePassDiffRatioInput(refinePassInput?.value, 0.02);
        const jobId = await startRefineJob(
          "/api/refine-structure/" + encodeURIComponent(targetSlug),
          {
            bucket,
            maxIters,
            maxOpsPerIter: 8,
            topOffenders,
            passDiffRatio,
            dryRun: false,
          },
          "Structure refine"
        );
        if (jobId) monitorRefineJobSse(jobId);
      }

      async function runRefineUntilPass() {
        const b = activeBucket();
        const targetSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!targetSlug) return;
        const maxIters = Math.max(1, Math.min(8, Number(refineItersInput?.value || 3)));
        const topOffenders = Math.max(1, Math.min(40, Number(refineTopInput?.value || 12)));
        const passDiffRatio = parsePassDiffRatioInput(refinePassInput?.value, 0.02);
        const jobId = await startRefineJob(
          "/api/refine/" + encodeURIComponent(targetSlug),
          { bucket: "all", maxIters, topOffenders, passDiffRatio, dryRun: false },
          "AI refine"
        );
        if (!jobId) return;
        monitorRefineJobSse(jobId, async (jobState) => {
          const result = jobState?.result || {};
          const iters = Array.isArray(result?.iterations) ? result.iterations : [];
          const latest = iters.length ? iters[iters.length - 1] : null;
          const scoresAfter = latest?.after || {};
          const worstBucket = pickWorstBucketFromScores(scoresAfter) || b;
          const worstDiff = Number(scoresAfter?.[worstBucket]?.diffRatio || 1);
          const passAll = ["desktop", "tablet", "mobile"]
            .filter((x) => scoresAfter && scoresAfter[x])
            .every((x) => Number(scoresAfter?.[x]?.diffRatio || 1) <= passDiffRatio);
          const plateau = String(result?.stoppedReason || "") === "plateau";
          const hugeDiff = Number.isFinite(worstDiff) && worstDiff > 0.15 && iters.length >= 1;
          const stoppedReason = String(result?.stoppedReason || "");
          if (!passAll && (plateau || hugeDiff || stoppedReason === "no-improvement" || stoppedReason === "regressed")) {
            showRefineToast("Escalating to structure refine (" + worstBucket + ")", "info");
            await runStructureRefine(worstBucket);
          }
        });
      }

      async function undoStructureRefine() {
        const targetSlug = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!targetSlug) return;
        const b = activeBucket();
        const response = await fetch("/api/refine-structure/" + encodeURIComponent(targetSlug) + "/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: b }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          alert((payload && payload.error) ? payload.error : "Undo failed");
          return;
        }
        try {
          await window.reloadCurrentPreview({ preserveOverlayState: true });
        } catch (_) {
          location.reload();
        }
      }

      async function stopCurrentRefineJob() {
        if (!currentRefineJobId) return;
        await fetch("/api/refine-stop/" + encodeURIComponent(currentRefineJobId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => null);
        stopPolling();
        setRefineControlsDisabled(false);
        currentRefineJobId = "";
        setStatus("Stop requested. Controls unlocked.");
        showRefineToast("Stop requested", "info");
      }

      if (refineBtn) refineBtn.addEventListener("click", () => runRefineUntilPass());
      if (refineAdvancedToggleBtn) {
        refineAdvancedToggleBtn.addEventListener("click", () => {
          const expanded = String(refineAdvancedToggleBtn.getAttribute("aria-expanded") || "false") === "true";
          setAdvancedOpen(!expanded);
        });
      }
      if (refineDesktopBtn) refineDesktopBtn.addEventListener("click", () => runRefine("desktop"));
      if (refineTabletBtn) refineTabletBtn.addEventListener("click", () => runRefine("tablet"));
      if (refineMobileBtn) refineMobileBtn.addEventListener("click", () => runRefine("mobile"));
      if (refineAllBtn) refineAllBtn.addEventListener("click", () => runRefine("all"));
      if (refineStructureBtn) refineStructureBtn.addEventListener("click", () => runStructureRefine(activeBucket()));
      if (refineUntilPassBtn) refineUntilPassBtn.addEventListener("click", () => runRefineUntilPass());
      if (refineUndoBtn) refineUndoBtn.addEventListener("click", () => undoStructureRefine());
      if (refineStopBtn) refineStopBtn.addEventListener("click", () => stopCurrentRefineJob());

      const qaGateBtn = document.getElementById("qa_gate_btn");
      const qaGateBackdrop = document.getElementById("qa_gate_modal_backdrop");
      const qaGateClose = document.getElementById("qa_gate_modal_close");
      const qaGateCloseFooter = document.getElementById("qa_gate_modal_close_footer");
      const qaGateApply = document.getElementById("qa_gate_apply");
      const qaGateRunLoop = document.getElementById("qa_gate_run_loop");
      const qaGateEject = document.getElementById("qa_gate_eject");
      const qaGateEjectClean = document.getElementById("qa_gate_eject_clean");
      const qaGateCopyPreviewHtml = document.getElementById("qa_gate_copy_preview_html");
      const qaGateCopyCleanHtml = document.getElementById("qa_gate_copy_clean_html");
      const qaGateBack = document.getElementById("qa_gate_back");
      const qaGateExport = document.getElementById("qa_gate_export");
      const qaGateSlugEl = document.getElementById("qa_gate_slug");
      const qaGateLoopStatus = document.getElementById("qa_gate_loop_status");
      const qaGateIterations = document.getElementById("qa_gate_iterations");
      const qaGateReportBefore = document.getElementById("qa_gate_report_before");
      const qaGateFixes = document.getElementById("qa_gate_fixes");
      const qaGateDiff = document.getElementById("qa_gate_diff");
      const qaGateReportAfter = document.getElementById("qa_gate_report_after");
      const qaGateRemaining = document.getElementById("qa_gate_remaining");

      let qaGatePayload = null;
      let qaCleanFragmentHtml = "";

      function formatReport(report, groupedByRule) {
        if (!report) return "—";
        const s = report.summary;
        const lines = [
          "Errors: " + (s?.error ?? 0) + ", Warnings: " + (s?.warn ?? 0) + ", Info: " + (s?.info ?? 0),
          "",
        ];
        if (groupedByRule && report.byRule && Object.keys(report.byRule).length) {
          lines.push("By rule: " + Object.entries(report.byRule).map(([r, n]) => r + ": " + n).join(", "));
          lines.push("");
        }
        (report.issues || []).forEach((i) => {
          lines.push("[" + (i.severity || "?") + "] " + (i.rule || "") + ": " + (i.message || ""));
          if (i.selector) lines.push("  " + i.selector);
          if (i.snippet) lines.push("  " + (i.snippet.length > 60 ? i.snippet.slice(0, 60) + "\u2026" : i.snippet));
          if (i.fatal && i.minimalReport) {
            lines.push("  ---");
            lines.push("  Diff-like report (node ids + snippet); auto-fix blocked if not adjacent/identical:");
            String(i.minimalReport).split("\\n").forEach((line) => lines.push("  " + line));
          }
        });
        return lines.join("\\n");
      }

      function escapeHtmlText(v) {
        return String(v || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      function normalizeForCompare(v) {
        return String(v || "").replace(/\s+/g, " ").trim();
      }

      function renderIterations(iterations) {
        if (!qaGateIterations) return;
        const list = Array.isArray(iterations) ? iterations : [];
        if (!list.length) {
          qaGateIterations.innerHTML = "—";
          return;
        }
        qaGateIterations.innerHTML = list
          .map((it) => {
            const before = Number(it?.issuesBefore || 0);
            const after = Number(it?.issuesAfter || 0);
            const fixes = Array.isArray(it?.appliedFixes) ? it.appliedFixes : [];
            const byRule = (it?.reportAfter && it.reportAfter.byRule && typeof it.reportAfter.byRule === "object")
              ? it.reportAfter.byRule
              : {};
            const byRuleLine = Object.keys(byRule).length
              ? "Remaining by rule: " + Object.entries(byRule).map(([k, v]) => k + "=" + v).join(", ")
              : "Remaining by rule: none";
            const header = "Iteration " + Number(it?.iteration || 0) + " — " + before + " -> " + after + " issues";
            const fixLines = fixes.length
              ? fixes
                  .map((f) => "Issue " + (f.issueId || "—") + " -> " + (f.action || "applied"))
                  .join("\\n")
              : "No fixes applied.";
            const body = byRuleLine + "\\n\\n" + fixLines;
            return '<details><summary>' + escapeHtmlText(header) + '</summary><pre style="margin:8px 0 0 0;white-space:pre-wrap;">' + escapeHtmlText(body) + '</pre></details>';
          })
          .join("");
      }

      function setQAGateModalOpen(open) {
        if (!qaGateBackdrop) return;
        qaGateBackdrop.dataset.open = open ? "1" : "0";
        qaGateBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
      }

      function getPreviewFinalHtml() {
        const iframe = document.getElementById("vp_iframe");
        if (!iframe || !iframe.contentDocument || !iframe.contentDocument.body) return "";
        const doc = iframe.contentDocument;
        const root = doc.querySelector('[data-key="root"]');
        if (root) {
          const section = root.closest("section");
          return String((section && section.outerHTML) || root.outerHTML || "").trim();
        }
        const bodyClone = doc.body.cloneNode(true);
        Array.prototype.forEach.call(
          bodyClone.querySelectorAll("script,style,link,meta,#mackeeper-extension,[id$='-extension']"),
          (n) => n.remove()
        );
        const section = bodyClone.querySelector("section");
        if (section) return String(section.outerHTML || "").trim();
        return String(bodyClone.innerHTML || "").trim();
      }

      function applyFixedHtmlToIframe(fixedHtml) {
        const iframe = document.getElementById("vp_iframe");
        if (!iframe || !fixedHtml) return false;
        try {
          const doc = iframe.contentDocument;
          if (!doc || !doc.body) return false;
          const body = doc.body;
          const html = String(fixedHtml || "").trim();
          if (!html) return false;

          // Replace only the rendered fragment so Tailwind/widget scripts in <body> stay intact.
          const root = doc.querySelector('[data-key="root"]');
          const target = (root && (root.closest("section") || root)) || null;
          if (target) {
            target.outerHTML = html;
            return true;
          }

          // Fallback: remove non-script nodes, keep script/runtime nodes.
          Array.from(body.children).forEach((el) => {
            if ((el.tagName || "").toLowerCase() !== "script") el.remove();
          });
          const anchor = body.querySelector("script");
          const tmp = doc.createElement("div");
          tmp.innerHTML = html;
          while (tmp.firstChild) {
            body.insertBefore(tmp.firstChild, anchor || null);
          }
          return true;
        } catch (_) {}
        return false;
      }

      function resolveSourceStageForApply() {
        const fromPayload = String((qaGatePayload && qaGatePayload.sourceStage) || "").trim().toLowerCase();
        if (fromPayload === "generate" || fromPayload === "codeit" || fromPayload === "improve") return fromPayload;
        const fromQs = String(new URLSearchParams(location.search).get("stage") || "").trim().toLowerCase();
        if (fromQs === "generate" || fromQs === "codeit" || fromQs === "improve") return fromQs;
        return "improve";
      }

      function normalizeRootFixedWidthHtml(html) {
        const source = String(html || "").trim();
        if (!source) return { changed: false, reason: "empty-html", html: source };

        const openTagMatch = source.match(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*data-key=(?:"root"|'root')[^>]*)>/i);
        if (!openTagMatch) return { changed: false, reason: "root-not-found", html: source };
        const fullOpenTag = String(openTagMatch[0] || "");
        const classMatch = fullOpenTag.match(/\bclass=(?:"([\s\S]*?)"|'([\s\S]*?)')/i);
        if (!classMatch) return { changed: false, reason: "root-no-class", html: source };

        const quote = classMatch[0].includes('class="') ? '"' : "'";
        const classValue = String(classMatch[1] || classMatch[2] || "").trim();
        if (!classValue) return { changed: false, reason: "root-no-class", html: source };
        const tokens = classValue.split(/\s+/).filter(Boolean);

        const cleaned = tokens.filter((token) => {
          const core = String(token || "").split(":").pop();
          if (core === "w-full") return true;
          if (/^w-\[.+\]$/.test(core)) return false;
          if (/^w-(?:\d+|px)$/.test(core)) return false;
          return true;
        });
        if (cleaned.length === tokens.length) return { changed: false, reason: "nothing-to-remove", html: source };

        const nextClassAttr = "class=" + quote + cleaned.join(" ") + quote;
        const updatedOpenTag = fullOpenTag.replace(classMatch[0], nextClassAttr);
        const nextHtml = source.replace(fullOpenTag, updatedOpenTag);
        return { changed: true, reason: "applied", html: nextHtml };
      }

      if (qaGateBtn) {
        qaGateBtn.addEventListener("click", () => runQAFixLoop(10));
      }

      async function runQAFixLoop(maxIterations) {
        const slugForQa = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!slugForQa) {
          alert("No slug available for QA Fix Loop.");
          return;
        }
        qaGateSlugEl.textContent = slugForQa;
        qaGateReportBefore.textContent = "Running QA fix loop…";
        qaGateFixes.textContent = "—";
        qaGateDiff.textContent = "—";
        qaGateReportAfter.textContent = "—";
        renderIterations([]);
        qaGatePayload = null;
        qaCleanFragmentHtml = "";
        if (qaGateApply) qaGateApply.disabled = true;
        if (qaGateLoopStatus) qaGateLoopStatus.textContent = "Running...";
        setQAGateModalOpen(true);

        try {
          const finalHtml = getPreviewFinalHtml();
          if (!finalHtml) {
            qaGateReportBefore.textContent = "QA Fix Loop failed: preview finalHtml is empty/unavailable.";
            return;
          }
          const res = await fetch("/api/qa-gate/fix-loop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug: slugForQa,
              finalHtml,
              previewHtml: finalHtml,
              maxIterations: Number(maxIterations || 10),
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) {
            qaGateReportBefore.textContent = data?.error || "QA Fix Loop failed.";
            if (qaGateLoopStatus) qaGateLoopStatus.textContent = "Failed.";
            return;
          }
          qaGatePayload = data;
          if (data.currentHtml != null) data.originalHtmlSnapshot = data.currentHtml;

          if (qaGateLoopStatus) {
            const iter = Number(data.iterationsCount || (Array.isArray(data.iterations) ? data.iterations.length : 0));
            const remain = Number(data.remainingIssues || 0);
            const suffix = data.hitLimit && remain > 0 ? " (limit reached)" : "";
            qaGateLoopStatus.textContent = "Iterations: " + iter + " | Remaining issues: " + remain + suffix;
          }
          renderIterations(data.iterations || []);

          if (qaGateRemaining) {
            const err = data.remainingErrors ?? (data.reportAfter?.summary?.error ?? 0);
            const warn = data.reportAfter?.summary?.warn ?? 0;
            const info = data.reportAfter?.summary?.info ?? 0;
            const total = (data.reportAfter?.issues || []).length;
            qaGateRemaining.textContent = "Remaining issues after fix loop: " + total + " (errors: " + err + ", warnings: " + warn + ", info: " + info + ")";
            qaGateRemaining.classList.remove("hidden");
            if (err > 0) qaGateRemaining.classList.add("text-red-600"); else qaGateRemaining.classList.remove("text-red-600");
          }
          qaGateReportBefore.textContent = formatReport(data.reportBefore, true);
          qaGateFixes.textContent = Array.isArray(data.appliedFixes) && data.appliedFixes.length
            ? data.appliedFixes
                .map((f) => f.issueId + " – " + (f.action || "") + "\\n  before: " + (f.beforeSnippet || "").slice(0, 50) + "\\n  after: " + (f.afterSnippet || "").slice(0, 50))
                .join("\\n\\n")
            : "No auto-fixes applied.";
          qaGateDiff.textContent = data.diff || "—";
          qaGateReportAfter.textContent = formatReport(data.reportAfter, true);
          if (qaGateApply) qaGateApply.disabled = !!data.blockApply;

          // Persist and render best fragment in preview state immediately.
          if (data.fixedHtml) {
            let persisted = false;
            if (!data.blockApply && data.slug && data.sourceStage) {
              const saveRes = await fetch("/api/qa-gate/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slug: data.slug, fixedHtml: data.fixedHtml, sourceStage: data.sourceStage }),
              }).catch(() => null);
              persisted = Boolean(saveRes && saveRes.ok);
            }
            const fixCount = Array.isArray(data.appliedFixes) ? data.appliedFixes.length : 0;
            if (qaGateLoopStatus) {
              let status = qaGateLoopStatus.textContent || "";
              if (fixCount > 0) status += " | " + fixCount + " fix(es) applied.";
              status += persisted
                ? " Saved. Use Open preview (or refresh manually) to view updated stage output."
                : ' Could not persist automatically - use "Copy Preview HTML" to copy the updated code.';
              qaGateLoopStatus.textContent = status;
            }
            if (persisted && data.slug && data.sourceStage) {
              setStageActive(data.sourceStage, true);
              const nextPreviewUrl =
                "/preview/" +
                encodeURIComponent(data.slug) +
                "?stage=" +
                encodeURIComponent(data.sourceStage);
              setPreviewUrl(nextPreviewUrl);
            }
          }
        } catch (err) {
          qaGateReportBefore.textContent = "Error: " + String(err?.message || err);
          if (qaGateLoopStatus) qaGateLoopStatus.textContent = "Error.";
        }
      }

      if (qaGateRunLoop) {
        qaGateRunLoop.addEventListener("click", () => runQAFixLoop(10));
      }

      if (qaFixRootWidthBtn) {
        qaFixRootWidthBtn.addEventListener("click", async () => {
          const currentHtml = getPreviewFinalHtml();
          if (!currentHtml) {
            if (qaGateLoopStatus) qaGateLoopStatus.textContent = "Root width check completed. Preview HTML unavailable.";
            return;
          }
          const out = normalizeRootFixedWidthHtml(currentHtml);
          const fixedHtml = String((out && out.html) || currentHtml || "");
          const slugForQa = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
          const sourceStage = resolveSourceStageForApply();
          let persisted = false;
          if (slugForQa) {
            const saveRes = await fetch("/api/qa-gate/apply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: slugForQa, fixedHtml, sourceStage }),
            }).catch(() => null);
            persisted = Boolean(saveRes && saveRes.ok);
          }
          if (qaGateLoopStatus) {
            if (persisted) {
              qaGateLoopStatus.textContent = out.changed
                ? "Root width fix applied and saved. Use Open preview (or refresh manually) to view changes."
                : "Root width check completed (no conflicts found). Stage saved unchanged.";
            } else {
              qaGateLoopStatus.textContent = out.changed
                ? "Root width fix found changes but could not be saved automatically."
                : "Root width check completed (no conflicts found).";
            }
          }
          if (persisted && slugForQa) {
            setStageActive(sourceStage, true);
            const nextPreviewUrl =
              "/preview/" +
              encodeURIComponent(slugForQa) +
              "?stage=" +
              encodeURIComponent(sourceStage);
            setPreviewUrl(nextPreviewUrl);
          }
        });
      }

      async function prepareCleanFragment() {
        const slugForQa = String(window.__CURRENT_PREVIEW_SLUG__ || slug || "").trim();
        if (!slugForQa) return null;
        const finalHtml = getPreviewFinalHtml();
        if (!finalHtml) {
          alert("Clean fragment failed: preview finalHtml is empty/unavailable.");
          return null;
        }
        const res = await fetch("/api/qa-gate/clean-fragment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: slugForQa, finalHtml }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok || !data.cleanedHtml) {
          throw new Error(data?.error || "Clean fragment export failed.");
        }
        qaCleanFragmentHtml = String(data.cleanedHtml || "");
        return { slugForQa, html: qaCleanFragmentHtml };
      }

      if (qaCleanFragmentBtn) {
        qaCleanFragmentBtn.addEventListener("click", async () => {
          try {
            setQAGateModalOpen(true);
            if (qaGateLoopStatus) qaGateLoopStatus.textContent = "Preparing clean fragment...";
            const prepared = await prepareCleanFragment();
            if (!prepared) return;
            if (qaGateLoopStatus) qaGateLoopStatus.textContent = "Clean fragment ready. Use copy/eject actions.";
          } catch (err) {
            alert(String(err?.message || err));
          }
        });
      }

      if (qaGateClose) qaGateClose.addEventListener("click", () => setQAGateModalOpen(false));
      if (qaGateCloseFooter) qaGateCloseFooter.addEventListener("click", () => setQAGateModalOpen(false));
      if (qaGateBackdrop) {
        qaGateBackdrop.addEventListener("click", (e) => {
          if (e.target === qaGateBackdrop) setQAGateModalOpen(false);
        });
      }

      if (qaGateEject) {
        qaGateEject.addEventListener("click", async () => {
          const p = qaGatePayload;
          if (!p?.fixedHtml || !p?.slug || !p?.sourceStage) return;
          try {
            const res = await fetch("/api/qa-gate/apply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: p.slug, fixedHtml: p.fixedHtml, sourceStage: p.sourceStage }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok) {
              setStageActive(p.sourceStage, true);
              const nextPreviewUrl =
                "/preview/" +
                encodeURIComponent(p.slug) +
                "?stage=" +
                encodeURIComponent(p.sourceStage);
              setPreviewUrl(nextPreviewUrl);
              applyFixedHtmlToIframe(p.fixedHtml);
              setQAGateModalOpen(false);
            } else {
              alert(data?.error || "Open preview failed.");
            }
          } catch (err) {
            alert(String(err?.message || err));
          }
        });
      }

      if (qaGateEjectClean) {
        qaGateEjectClean.addEventListener("click", async () => {
          try {
            qaGateEjectClean.disabled = true;
            qaGateEjectClean.textContent = "Preparing...";
            const prepared = qaCleanFragmentHtml
              ? { slugForQa: String(window.__CURRENT_PREVIEW_SLUG__ || slug || "fragment").trim() || "fragment", html: qaCleanFragmentHtml }
              : await prepareCleanFragment();
            if (!prepared) return;

            const a = document.createElement("a");
            const htmlBlob = new Blob([String(prepared.html || "")], { type: "text/html" });
            a.href = URL.createObjectURL(htmlBlob);
            a.download = String(prepared.slugForQa || "fragment") + ".clean.html";
            a.click();
            URL.revokeObjectURL(a.href);
          } catch (err) {
            alert(String(err?.message || err));
          } finally {
            qaGateEjectClean.disabled = false;
            qaGateEjectClean.textContent = "Eject clean fragment";
          }
        });
      }

      if (qaGateCopyPreviewHtml) {
        qaGateCopyPreviewHtml.addEventListener("click", async () => {
          const html = String(getPreviewFinalHtml() || (qaGatePayload && qaGatePayload.fixedHtml) || "");
          if (!html) return;
          try {
            await navigator.clipboard.writeText(html);
            qaGateCopyPreviewHtml.textContent = "Copied";
            setTimeout(() => {
              qaGateCopyPreviewHtml.textContent = "Copy Preview HTML";
            }, 1200);
          } catch (_) {
            alert("Copy failed.");
          }
        });
      }

      if (qaGateCopyCleanHtml) {
        qaGateCopyCleanHtml.addEventListener("click", async () => {
          try {
            if (!qaCleanFragmentHtml) {
              await prepareCleanFragment();
            }
            if (!qaCleanFragmentHtml) return;
            await navigator.clipboard.writeText(qaCleanFragmentHtml);
            qaGateCopyCleanHtml.textContent = "Copied";
            setTimeout(() => {
              qaGateCopyCleanHtml.textContent = "Copy Clean Fragment";
            }, 1200);
          } catch (err) {
            alert(String(err?.message || err));
          }
        });
      }

      if (qaGateBack) {
        qaGateBack.addEventListener("click", () => {
          setQAGateModalOpen(false);
          const next = location.pathname + "?stage=improve" + (location.hash || "");
          location.href = next;
        });
      }

      if (qaGateApply) {
        qaGateApply.addEventListener("click", async function applyHandler() {
          const p = qaGatePayload;
          if (p?.blockApply) {
            alert("QA apply is blocked: QA_INPUT_MISMATCH (fatal). Re-open QA Gate once preview and audit input are aligned.");
            return;
          }
          if (!p?.fixedHtml || !p?.slug || !p?.sourceStage) return;
          try {
            const res = await fetch("/api/qa-gate/apply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: p.slug, fixedHtml: p.fixedHtml, sourceStage: p.sourceStage }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok) {
              applyFixedHtmlToIframe(p.fixedHtml);
              setStageActive(p.sourceStage, true);
              const nextPreviewUrl =
                "/preview/" +
                encodeURIComponent(p.slug) +
                "?stage=" +
                encodeURIComponent(p.sourceStage);
              setPreviewUrl(nextPreviewUrl);
              if (qaGateLoopStatus) {
                qaGateLoopStatus.textContent = "Fixes applied. Click Open preview to reload this stage with overlay.";
              }
            } else {
              alert(data?.error || "Apply failed.");
            }
          } catch (err) {
            alert(String(err?.message || err));
          }
        });
      }

      if (qaGateExport) {
        qaGateExport.addEventListener("click", () => {
          const p = qaGatePayload;
          if (!p) return;
          const report = {
            reportBefore: p.reportBefore,
            reportAfter: p.reportAfter,
            appliedFixes: p.appliedFixes,
          };
          const jsonBlob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
          const textLines = [
            "QA Gate Report",
            "Slug: " + (p.slug || "—"),
            "Source stage: " + (p.sourceStage || "—"),
            "",
            "=== Audit (before) ===",
            formatReport(p.reportBefore, true),
            "",
            "=== Applied fixes ===",
            Array.isArray(p.appliedFixes) ? p.appliedFixes.map((f) => f.issueId + " " + (f.action || "")).join("\\n") : "—",
            "",
            "=== Audit (after) ===",
            formatReport(p.reportAfter, true),
            "",
            "=== Diff (excerpt) ===",
            p.diff || "—",
          ];
          const textBlob = new Blob([textLines.join("\\n")], { type: "text/plain" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(jsonBlob);
          a.download = "qa-report.json";
          a.click();
          URL.revokeObjectURL(a.href);
          a.href = URL.createObjectURL(textBlob);
          a.download = "qa-report.txt";
          a.click();
          URL.revokeObjectURL(a.href);
        });
      }
    })();
  </script>

  <script>
    (function(){
      const helpers = window.__patchHelpers__;
      const editorRoot = document.getElementById("editor_root");
      if (!helpers || !editorRoot) return;

      const allowedStages = ["generate", "codeit", "improve"];
      const qs = new URLSearchParams(location.search);
      const stage = allowedStages.includes(String(qs.get("stage") || "generate").toLowerCase())
        ? String(qs.get("stage") || "generate").toLowerCase()
        : "generate";

      const slug = String(window.__CURRENT_PREVIEW_SLUG__ || (document.body && document.body.getAttribute("data-preview-slug")) || "").trim();
      if (!slug) return;

      const selectBtn = document.getElementById("editor_select");
      const pickBtn = document.getElementById("editor_pick");
      const clearBtn = document.getElementById("editor_clear");
      const nodeInput = document.getElementById("editor_node_input");
      const classesInput = document.getElementById("editor_classes");
      const ariaLabelInput = document.getElementById("editor_aria_label");
      const ariaLabelledByInput = document.getElementById("editor_aria_labelledby");
      const ariaDescribedByInput = document.getElementById("editor_aria_describedby");
      const ariaHiddenInput = document.getElementById("editor_aria_hidden");
      const applyBtn = document.getElementById("editor_apply");
      const statusEl = document.getElementById("editor_status");
      const ledgerEl = document.getElementById("editor_ledger");
      const selectedLabel = document.getElementById("editor_selected");
      const htmlInput = document.getElementById("editor_html");
      const htmlRefreshBtn = document.getElementById("editor_html_refresh");
      const htmlCopyBtn = document.getElementById("editor_html_copy");

      let selecting = false;
      let selectedEl = null;
      let selectedNodeId = "";
      let selectedSelector = "";
      let baseMap = new Map();
      let userData = { patches: [], ledger: [] };
      let classEditor = null;
      let htmlEditor = null;

      const setStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg || "";
      };

      const escapeSelector = (v) => String(v || "").replace(/"/g, '\\"');

      const setClassesValue = (value) => {
        if (classEditor) classEditor.setValue(String(value || ""));
        else if (classesInput) classesInput.value = String(value || "");
      };

      const getClassesValue = () => {
        if (classEditor) return classEditor.getValue();
        return classesInput ? String(classesInput.value || "") : "";
      };

      const setHtmlValue = (value) => {
        if (htmlEditor) htmlEditor.setValue(String(value || ""));
        else if (htmlInput) htmlInput.value = String(value || "");
      };

      const getHtmlValue = () => {
        if (htmlEditor) return htmlEditor.getValue();
        return htmlInput ? String(htmlInput.value || "") : "";
      };

      const initEditors = () => {
        if (!window.CodeMirror) return false;
        if (classesInput && !classEditor) {
          classEditor = window.CodeMirror.fromTextArea(classesInput, {
            lineWrapping: true,
            mode: "text/plain",
          });
        }
        if (htmlInput && !htmlEditor) {
          htmlEditor = window.CodeMirror.fromTextArea(htmlInput, {
            lineWrapping: true,
            lineNumbers: true,
            mode: "htmlmixed",
            readOnly: true,
          });
        }
        return true;
      };

      const waitForCodeMirror = () => {
        if (initEditors()) return;
        setTimeout(waitForCodeMirror, 300);
      };

      const ensureHighlightStyle = (doc) => {
        if (!doc || !doc.head) return;
        if (doc.getElementById("editor_highlight_style")) return;
        const style = doc.createElement("style");
        style.id = "editor_highlight_style";
        style.textContent = '[data-editor-selected="1"]{ outline:2px solid #f59e0b; outline-offset:2px; }';
        doc.head.appendChild(style);
      };

      const findEditableNode = (el) => {
        if (!el) return null;
        if (el.hasAttribute("data-node-id") || el.hasAttribute("data-key")) return el;
        return el.closest("[data-node-id],[data-key]");
      };

      const getNodeId = (el) =>
        (el && (el.getAttribute("data-node-id") || el.getAttribute("data-key"))) || "";

      const setSelectedEl = (el) => {
        ensureHighlightStyle(helpers.resolveDoc());
        if (selectedEl && selectedEl !== el) {
          try { selectedEl.removeAttribute("data-editor-selected"); } catch {}
        }
        selectedEl = el;
        selectedNodeId = el ? getNodeId(el) : "";
        selectedSelector = selectedNodeId
          ? (el.hasAttribute("data-node-id")
              ? '[data-node-id="' + escapeSelector(selectedNodeId) + '"]'
              : '[data-key="' + escapeSelector(selectedNodeId) + '"]')
          : "";
        if (el) {
          try { el.setAttribute("data-editor-selected", "1"); } catch {}
        }
        if (selectedLabel) {
          selectedLabel.textContent = selectedNodeId ? selectedNodeId : "No selection";
        }
        if (nodeInput) nodeInput.value = selectedNodeId || "";
        setClassesValue(el ? String(el.getAttribute("class") || "") : "");
        if (ariaLabelInput) {
          ariaLabelInput.value = el ? String(el.getAttribute("aria-label") || "") : "";
        }
        if (ariaLabelledByInput) {
          ariaLabelledByInput.value = el ? String(el.getAttribute("aria-labelledby") || "") : "";
        }
        if (ariaDescribedByInput) {
          ariaDescribedByInput.value = el ? String(el.getAttribute("aria-describedby") || "") : "";
        }
        if (ariaHiddenInput) {
          ariaHiddenInput.checked = el ? el.getAttribute("aria-hidden") === "true" : false;
        }
      };

      const attachSelectionListener = () => {
        const doc = helpers.resolveDoc();
        if (!doc) return;
        ensureHighlightStyle(doc);
        doc.addEventListener(
          "click",
          (event) => {
            if (!selecting) return;
            const target = findEditableNode(event.target);
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            selecting = false;
            if (selectBtn) selectBtn.textContent = "Select element";
            setSelectedEl(target);
          },
          true
        );
      };

      const tokenPrefix = (token) => {
        const core = String(token || "").split(":").pop();
        const dash = core.indexOf("-");
        if (dash > 0) return core.slice(0, dash);
        const bracket = core.indexOf("[");
        if (bracket > 0) return core.slice(0, bracket);
        return core;
      };

      const diffClasses = (baseTokens, nextTokens) => {
        const baseSet = new Set(baseTokens);
        const nextSet = new Set(nextTokens);
        const added = nextTokens.filter((t) => !baseSet.has(t));
        const removed = baseTokens.filter((t) => !nextSet.has(t));
        const classReplace = {};
        const remainingAdd = [...added];
        const remainingRemove = [];

        removed.forEach((rm) => {
          const prefix = tokenPrefix(rm);
          const idx = remainingAdd.findIndex((ad) => tokenPrefix(ad) === prefix);
          if (idx >= 0) {
            classReplace[rm] = remainingAdd[idx];
            remainingAdd.splice(idx, 1);
          } else {
            remainingRemove.push(rm);
          }
        });

        return {
          classAdd: remainingAdd,
          classRemove: remainingRemove,
          classReplace,
        };
      };

      const parseTokens = (value) =>
        String(value || "")
          .split(/\\s+/g)
          .map((t) => t.trim())
          .filter(Boolean);

      const buildBaseMap = async () => {
        const artifact = await helpers.loadStageArtifact(slug, stage);
        if (!artifact || !artifact.html) return;
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(String(artifact.html || ""), "text/html");
          if (artifact.patches) {
            helpers.applyAll(doc, artifact.patches, stage);
          }
          const nodes = Array.from(doc.querySelectorAll("[data-node-id],[data-key]"));
          nodes.forEach((node) => {
            const id = node.getAttribute("data-node-id") || node.getAttribute("data-key");
            if (!id) return;
            baseMap.set(String(id), {
              classes: parseTokens(node.getAttribute("class") || ""),
              ariaLabel: String(node.getAttribute("aria-label") || ""),
              ariaLabelledBy: String(node.getAttribute("aria-labelledby") || ""),
              ariaDescribedBy: String(node.getAttribute("aria-describedby") || ""),
              ariaHidden: node.getAttribute("aria-hidden") === "true",
            });
          });
        } catch {}
      };

      const refreshHtmlView = async () => {
        if (!htmlInput) return;
        const iframe = document.getElementById("vp_iframe");
        if (iframe && iframe.contentDocument && iframe.contentDocument.documentElement) {
          const doc = iframe.contentDocument;
          const root = doc.documentElement;
          const isReady = root && root.classList && root.classList.contains("tw-ready");
          if (isReady) {
            const body = doc.body ? doc.body.outerHTML : "";
            setHtmlValue(String(body || "").trim());
            return;
          }
          setHtmlValue("Waiting for preview iframe to be ready...");
          setTimeout(refreshHtmlView, 400);
          return;
        }

        setHtmlValue("Waiting for preview iframe...");
      };

      const loadUserData = async () => {
        const data = await helpers.loadUserPatches(slug);
        if (data && typeof data === "object") {
          userData = {
            patches: Array.isArray(data.patches) ? data.patches : [],
            ledger: Array.isArray(data.ledger) ? data.ledger : [],
          };
        }
        renderLedger();
      };

      const renderLedger = () => {
        if (!ledgerEl) return;
        const entries = Array.isArray(userData.ledger) ? userData.ledger.slice(-50).reverse() : [];
        if (!entries.length) {
          ledgerEl.innerHTML = '<div class="editor-ledger-item">No changes yet.</div>';
          return;
        }
        ledgerEl.innerHTML = entries
          .map((entry) => {
            const at = String(entry.at || "").replace("T", " ").replace("Z", "");
            const nodeId = entry.nodeId || "";
            const op = entry.op || "";
            const value = entry.value || "";
            return '<div class="editor-ledger-item"><span class="mono">' +
              at +
              "</span> " +
              nodeId +
              " " +
              op +
              " " +
              value +
              "</div>";
          })
          .join("");
      };

      const upsertPatch = (patch) => {
        if (!patch || !patch.nodeId) return;
        const idx = userData.patches.findIndex(
          (entry) => entry.nodeId === patch.nodeId && (entry.stage || "") === patch.stage
        );
        const hasOps =
          (patch.ops.classAdd && patch.ops.classAdd.length) ||
          (patch.ops.classRemove && patch.ops.classRemove.length) ||
          Object.keys(patch.ops.classReplace || {}).length ||
          Object.keys(patch.ops.attrAdd || {}).length ||
          (patch.ops.attrRemove && patch.ops.attrRemove.length);

        if (!hasOps) {
          if (idx >= 0) userData.patches.splice(idx, 1);
          return;
        }

        if (idx >= 0) userData.patches[idx] = patch;
        else userData.patches.push(patch);
      };

      const recordLedger = (nodeId, selector, op, value) => {
        userData.ledger.push({
          at: new Date().toISOString(),
          nodeId,
          selector,
          op,
          value,
        });
      };

      const saveUserData = async () => {
        try {
          setStatus("Saving...");
          const payload = {
            slug,
            stage,
            updatedAt: new Date().toISOString(),
            patches: userData.patches,
            ledger: userData.ledger,
          };
          const r = await fetch("/api/patches/" + encodeURIComponent(slug), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!r.ok) throw new Error("Save failed");
          setStatus("Saved");
          setTimeout(() => setStatus(""), 1200);
        } catch (e) {
          setStatus("Save failed");
        }
      };

      const applyPatch = () => {
        if (!selectedEl || !selectedNodeId) return;

        const base = baseMap.get(selectedNodeId) || {
          classes: parseTokens(selectedEl.getAttribute("class") || ""),
          ariaLabel: "",
          ariaLabelledBy: "",
          ariaDescribedBy: "",
          ariaHidden: false,
        };
        const desiredClasses = parseTokens(getClassesValue());
        const classOps = diffClasses(base.classes, desiredClasses);

        const attrAdd = {};
        const attrRemove = [];
        const desiredLabel = String(ariaLabelInput ? ariaLabelInput.value : "").trim();
        if (desiredLabel && desiredLabel !== base.ariaLabel) {
          attrAdd["aria-label"] = desiredLabel;
        } else if (!desiredLabel && base.ariaLabel) {
          attrRemove.push("aria-label");
        }

        const desiredLabelledBy = String(ariaLabelledByInput ? ariaLabelledByInput.value : "").trim();
        if (desiredLabelledBy && desiredLabelledBy !== base.ariaLabelledBy) {
          attrAdd["aria-labelledby"] = desiredLabelledBy;
        } else if (!desiredLabelledBy && base.ariaLabelledBy) {
          attrRemove.push("aria-labelledby");
        }

        const desiredDescribedBy = String(ariaDescribedByInput ? ariaDescribedByInput.value : "").trim();
        if (desiredDescribedBy && desiredDescribedBy !== base.ariaDescribedBy) {
          attrAdd["aria-describedby"] = desiredDescribedBy;
        } else if (!desiredDescribedBy && base.ariaDescribedBy) {
          attrRemove.push("aria-describedby");
        }

        const desiredHidden = Boolean(ariaHiddenInput && ariaHiddenInput.checked);
        if (desiredHidden && !base.ariaHidden) {
          attrAdd["aria-hidden"] = "true";
        } else if (!desiredHidden && base.ariaHidden) {
          attrRemove.push("aria-hidden");
        }

        const patch = {
          nodeId: selectedNodeId,
          selector: selectedSelector,
          stage,
          ops: {
            classAdd: classOps.classAdd,
            classRemove: classOps.classRemove,
            classReplace: classOps.classReplace,
            attrAdd,
            attrRemove,
          },
        };

        upsertPatch(patch);

        classOps.classAdd.forEach((cls) => recordLedger(selectedNodeId, selectedSelector, "classAdd", cls));
        classOps.classRemove.forEach((cls) => recordLedger(selectedNodeId, selectedSelector, "classRemove", cls));
        Object.keys(classOps.classReplace).forEach((from) => {
          recordLedger(selectedNodeId, selectedSelector, "classReplace", from + " -> " + classOps.classReplace[from]);
        });
        Object.keys(attrAdd).forEach((key) => {
          recordLedger(selectedNodeId, selectedSelector, "attrAdd", key + "=" + attrAdd[key]);
        });
        attrRemove.forEach((key) => recordLedger(selectedNodeId, selectedSelector, "attrRemove", key));

        helpers.applyAll(helpers.resolveDoc(), [patch], stage);
        renderLedger();
        saveUserData();
        refreshHtmlView();
      };

      if (selectBtn) {
        selectBtn.addEventListener("click", () => {
          selecting = !selecting;
          selectBtn.textContent = selecting ? "Click element…" : "Select element";
          if (selecting) attachSelectionListener();
        });
      }

      if (pickBtn) {
        pickBtn.addEventListener("click", () => {
          const doc = helpers.resolveDoc();
          if (!doc) return;
          const id = String(nodeInput ? nodeInput.value : "").trim();
          if (!id) return;
          const el =
            doc.querySelector('[data-node-id="' + escapeSelector(id) + '"]') ||
            doc.querySelector('[data-key="' + escapeSelector(id) + '"]');
          if (el) setSelectedEl(el);
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          if (selectedEl) {
            try { selectedEl.removeAttribute("data-editor-selected"); } catch {}
          }
          selectedEl = null;
          selectedNodeId = "";
          selectedSelector = "";
          if (selectedLabel) selectedLabel.textContent = "No selection";
          setClassesValue("");
          if (ariaLabelInput) ariaLabelInput.value = "";
          if (ariaLabelledByInput) ariaLabelledByInput.value = "";
          if (ariaDescribedByInput) ariaDescribedByInput.value = "";
          if (ariaHiddenInput) ariaHiddenInput.checked = false;
        });
      }

      if (applyBtn) {
        applyBtn.addEventListener("click", () => applyPatch());
      }

      if (htmlRefreshBtn) {
        htmlRefreshBtn.addEventListener("click", () => refreshHtmlView());
      }

      if (htmlCopyBtn) {
        htmlCopyBtn.addEventListener("click", async () => {
          try {
            const text = getHtmlValue();
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
              setStatus("Copied");
              setTimeout(() => setStatus(""), 1200);
            }
          } catch {
            setStatus("Copy failed");
          }
        });
      }

      waitForCodeMirror();

      buildBaseMap().then(loadUserData).then(() => {
        const doc = helpers.resolveDoc();
        if (doc) attachSelectionListener();
        refreshHtmlView();
      });

      const iframe = document.getElementById("vp_iframe");
      if (iframe) {
        iframe.addEventListener("load", () => {
          refreshHtmlView();
          try {
            const doc = iframe.contentDocument;
            if (doc) {
              doc.addEventListener("tailwind:ready", () => refreshHtmlView());
            }
          } catch {}
        });
      }
    })();
  </script>

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

      const getSlug = () => String(window.__CURRENT_PREVIEW_SLUG__ || (document.body && document.body.getAttribute("data-preview-slug")) || "").trim();

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
      const analysisSourceBadge = document.getElementById('analysis_source_badge');
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

      function applyAnalysisSourceBadge(score){
        if (!analysisSourceBadge) return;
        const source = String(score?.analysisSource || '').trim().toLowerCase();
        if (source === 'python') {
          analysisSourceBadge.textContent = 'analysis: python';
          analysisSourceBadge.style.background = 'rgba(220,252,231,1)';
          analysisSourceBadge.style.borderColor = 'rgba(134,239,172,1)';
          analysisSourceBadge.style.color = 'rgba(22,101,52,1)';
          return;
        }
        if (source === 'js') {
          analysisSourceBadge.textContent = 'analysis: js';
          analysisSourceBadge.style.background = 'rgba(241,245,249,1)';
          analysisSourceBadge.style.borderColor = 'rgba(203,213,225,1)';
          analysisSourceBadge.style.color = 'rgba(51,65,85,1)';
          return;
        }
        analysisSourceBadge.textContent = 'analysis: —';
        analysisSourceBadge.style.background = 'rgba(248,250,252,1)';
        analysisSourceBadge.style.borderColor = 'rgba(226,232,240,1)';
        analysisSourceBadge.style.color = 'rgba(100,116,139,1)';
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
          applyAnalysisSourceBadge(null);
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
        applyAnalysisSourceBadge(score);

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
          applyAnalysisSourceBadge(null);
        } finally {
          runCompareBtn.disabled = false;
          runCompareBtn.textContent = "Run compare";
        }
      });

      // Keep toolbar badge informative even when modal is closed.
      (async function initAnalysisSourceBadge(){
        const score = await loadLatestScore();
        applyAnalysisSourceBadge(score);
      })();
    })();
  </script>
  `
      : ""
  }

  <script>
    (function(){
      const visualQaBtn = document.getElementById('visual_qa_btn');
      const improveBtn = document.getElementById('improve_fidelity_btn');
      const toast = document.getElementById('refine_toast');
      const modalBackdrop = document.getElementById('visual_qa_modal_backdrop');
      if (!visualQaBtn && !improveBtn) return;
      function getSlug() {
        return String(window.__CURRENT_PREVIEW_SLUG__ || (document.body && document.body.getAttribute("data-preview-slug")) || "").trim();
      }
      function showToast(msg, isError) {
        if (!toast) return;
        toast.textContent = msg;
        toast.style.display = "block";
        toast.style.background = isError ? "rgba(180,0,0,.92)" : "rgba(15,23,42,.92)";
        setTimeout(function(){ toast.style.display = "none"; }, 8000);
      }
      function showModal(show) {
        if (!modalBackdrop) return;
        modalBackdrop.style.display = show ? "flex" : "none";
        modalBackdrop.setAttribute("aria-hidden", show ? "false" : "true");
      }
      function applyFinalHtmlToIframe(finalHtml) {
        const html = String(finalHtml || "").trim();
        if (!html) return false;
        const iframe = document.getElementById("vp_iframe");
        if (!iframe) return false;
        let doc = null;
        try { doc = iframe.contentDocument; } catch {}
        if (!doc || !doc.body) return false;
        const root = doc.querySelector('[data-key="root"]');
        const target = (root && (root.closest("section") || root)) || doc.querySelector("section") || null;
        if (!target) return false;
        try {
          target.outerHTML = html;
          if (typeof window.__previewViewportSync === "function") window.__previewViewportSync();
          return true;
        } catch {
          return false;
        }
      }
      if (visualQaBtn) visualQaBtn.addEventListener('click', async function() {
        const slug = getSlug();
        if (!slug) {
          showToast("No preview slug.", true);
          return;
        }
        visualQaBtn.disabled = true;
        visualQaBtn.textContent = "Running…";
        showModal(true);
        try {
          const r = await fetch("/api/visual-qa/" + encodeURIComponent(slug), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "report", reportOnly: true, passDiffRatio: 0.02, maxIterations: 1, patchBudget: 1 }),
          });
          const out = await r.json().catch(function() { return {}; });
          showModal(false);
          if (!r.ok) {
            showToast(out.error || "Visual QA failed (" + r.status + ")", true);
            return;
          }
          const issueCount = Number(out?.exhausted?.attemptedPatchCount || 0);
          const msg = "Visual QA report finished: " + (out.stoppedReason || "done") + ".";
          showToast(msg, false);
          if (issueCount > 0) console.log("[visual-qa] report summary", out);
        } catch (e) {
          showModal(false);
          showToast((e && e.message) ? e.message : "Visual QA request failed", true);
        } finally {
          visualQaBtn.disabled = false;
          visualQaBtn.textContent = "Run Visual QA";
        }
      });

      if (improveBtn) improveBtn.addEventListener('click', async function() {
        const slug = getSlug();
        if (!slug) {
          showToast("No preview slug.", true);
          return;
        }
        improveBtn.disabled = true;
        improveBtn.textContent = "Improving…";
        showModal(true);
        try {
          const r = await fetch("/api/build-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, refineMode: "visual", autoFix: 1, maxIterations: 5, patchBudget: 10 }),
          });
          const out = await r.json().catch(function() { return {}; });
          showModal(false);
          if (!r.ok || !out?.ok) {
            showToast(out?.error || "Improve fidelity failed", true);
            return;
          }
          const patchCount = Number(out?.qa?.totalPatchCount || 0);
          const appliedInline = applyFinalHtmlToIframe(out?.finalHtml);
          showToast("Improve fidelity finished. Patches: " + patchCount + (appliedInline ? " (applied to preview)." : "."), false);
          if (!appliedInline && typeof window.reloadCurrentPreview === "function") {
            window.reloadCurrentPreview({ preserveOverlayState: true }).catch(function() {});
          }
        } catch (e) {
          showModal(false);
          showToast((e && e.message) ? e.message : "Improve fidelity request failed", true);
        } finally {
          improveBtn.disabled = false;
          improveBtn.textContent = "Improve fidelity";
        }
      });
    })();
  </script>

  <script>
    (function(){
      const exportBtn = document.getElementById('export_btn');
      const typeSelect = document.getElementById('export_type');
      const rootLabel = document.getElementById('export_components_root');
      if (!exportBtn) return;

      const qs = new URLSearchParams(location.search);
      const qsType = String(qs.get('type') || '').trim();

      const getSlug = () => String(window.__CURRENT_PREVIEW_SLUG__ || (document.body && document.body.getAttribute("data-preview-slug")) || "").trim();

      let componentsRoot = "";

      function collectExportFragment() {
        const iframe = document.getElementById('vp_iframe');
        const doc = iframe ? iframe.contentDocument : null;
        if (!doc) return "";
        const root = doc.querySelector('[data-key="root"]');
        if (root && root.outerHTML) return root.outerHTML;
        return doc.body ? doc.body.innerHTML : "";
      }

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

        const fragmentHtml = collectExportFragment();
        if (!fragmentHtml) return alert('Export error: preview iframe not ready.');

        try {
          exportBtn.disabled = true;
          exportBtn.textContent = 'Exporting...';

          const payload = { slug, type, fragmentHtml };
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
      const toggleBtn = document.getElementById('sidebar_toggle');
      const closeBtn = document.getElementById('sidebar_close');
      const sidebar = document.getElementById('sidebar_root');
      if (!sidebar) return;

      function setOpen(open) {
        const isOpen = !!open;
        sidebar.style.transform = isOpen ? 'translateX(0)' : 'translateX(100%)';
        sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }

      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          const hidden = sidebar.getAttribute('aria-hidden') !== 'false';
          setOpen(hidden);
        });
      }
      if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setOpen(false);
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
        const sb = document.getElementById('sidebar_root');
        if (sb) sb.style.display = 'none';
        const eb = document.getElementById('export_root');
        if (eb) eb.style.display = 'none';
        const ed = document.getElementById('editor_root');
        if (ed) ed.style.display = 'none';
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

/** Safe for embedding in inline <script> inside a template literal: avoids </script>, `, and ${. */
function safeScriptString(value) {
  return JSON.stringify(String(value ?? ""))
    .replace(/<\//g, "<\\/")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

