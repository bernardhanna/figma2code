// generator/templates/preview/preview.viewport.js

export function viewportScript({ designW, slug }) {
  return `
  <script>
    (function(){
      const FALLBACK_DESIGN_W = ${JSON.stringify(Number(designW) || 1200)};
      const pageSlug = ${JSON.stringify(String(slug || ""))};

      const resp = (window.__RESPONSIVE__ && typeof window.__RESPONSIVE__ === "object")
        ? window.__RESPONSIVE__
        : null;

      const groupKey = (resp && typeof resp.groupKey === "string" && resp.groupKey.trim())
        ? resp.groupKey.trim()
        : pageSlug;

      const key = "previewViewport:" + groupKey;

      const btnM = document.getElementById("vp_mobile");
      const btnT = document.getElementById("vp_tablet");
      const btnD = document.getElementById("vp_desktop");

      const frame = document.getElementById("device_frame");
      const rail = document.getElementById("vp_rail");
      const thumb = document.getElementById("vp_thumb");
      const readout = document.getElementById("vp_readout");

      const cmp = document.getElementById("cmp_root");
      const ovImg = document.getElementById("ov_img");
      const bgLayer = document.getElementById("bg_layer");

      // NEW: content iframe (enables real Tailwind breakpoints)
      const vpIframe = document.getElementById("vp_iframe");

      // In embed mode there is no toolbar; bail cleanly
      if (!frame || !rail || !thumb || !readout || !btnM || !btnT || !btnD) return;

      const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
      const minW = 320;

      const bpMobileMax = Number(resp?.breakpoints?.mobileMax) || 768;
      const bpTabletMax = Number(resp?.breakpoints?.tabletMax) || 1084;

      const wMobile  = Number(resp?.widths?.mobile)  || 390;
      const wTablet  = Number(resp?.widths?.tablet)  || 1084;
      const wDesktop = Number(resp?.widths?.desktop) || FALLBACK_DESIGN_W;

      const maxW = Math.max(wDesktop, wTablet, wMobile, FALLBACK_DESIGN_W);

      frame.style.setProperty("--design-w", String(maxW) + "px");

      const state = (() => {
        try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; }
        catch { return {}; }
      })();

      function bucketForWidth(w){
        if (w <= bpMobileMax) return "mobile";
        if (w <= bpTabletMax) return "tablet";
        return "desktop";
      }

      function setActive(which){
        btnM.dataset.active = which === "mobile" ? "1" : "0";
        btnT.dataset.active = which === "tablet" ? "1" : "0";
        btnD.dataset.active = which === "desktop" ? "1" : "0";
      }

      function setThumb(w){
        const r = rail.getBoundingClientRect();
        const denom = (maxW - minW) || 1;
        const t = (w - minW) / denom;
        thumb.style.left = (t * r.width) + "px";
      }

      function preferredGroupOverlaySrc(bucket){
        if (!cmp) return "";
        const b = String(bucket || "").toLowerCase();
        const m = cmp.getAttribute("data-group-ov-mobile") || "";
        const t = cmp.getAttribute("data-group-ov-tablet") || "";
        const d = cmp.getAttribute("data-group-ov-desktop") || "";
        if (b === "mobile") return m || "";
        if (b === "tablet") return t || d || "";
        return d || "";
      }

      function preferredGroupBgSrc(bucket){
        if (!cmp) return "";
        const b = String(bucket || "").toLowerCase();
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

      function setBg(bucket){
        const src = preferredGroupBgSrc(bucket);
        if (!src) { applyBgStyle(""); return; }

        const img = new Image();
        img.onload = () => applyBgStyle(src);
        img.onerror = () => applyBgStyle("");
        img.src = src;
      }

      function setOverlay(bucket){
        if (!ovImg) return;
        const src = preferredGroupOverlaySrc(bucket);
        if (!src) return;

        if (ovImg.getAttribute("src") !== src) {
          ovImg.onerror = () => {};
          ovImg.src = src;
        }
      }

      function setOverlayClampForBucket(bucket){
        if (!cmp) return;
        const b = String(bucket || "").toLowerCase();

        const ow =
          b === "mobile" ? wMobile :
          b === "tablet" ? wTablet :
          wDesktop;

        cmp.style.setProperty("--overlay-w", ow + "px");
        cmp.dataset.bucket = b;

        if (ovImg) {
          const hinted = Number(resp?.overlayW?.[b]) || 0;
          const finalW = hinted > 0 ? hinted : ow;
          ovImg.style.maxWidth = finalW + "px";
        }
      }

      // NEW: keep iframe height tidy (optional, but prevents huge blank space)
      function setIframeWidth(w){
        if (!vpIframe) return;
        vpIframe.style.width = w + "px";
      }

      function tryAutoIframeHeight(){
        // If same-origin srcdoc is used, we can read scrollHeight
        if (!vpIframe) return;
        try {
          const doc = vpIframe.contentDocument;
          if (!doc) return;
          const h = Math.max(
            doc.documentElement?.scrollHeight || 0,
            doc.body?.scrollHeight || 0
          );
          if (h > 0) vpIframe.style.height = h + "px";
        } catch {
          // ignore cross-origin
        }
      }

      function setWidth(px, forcedLabel){
        const w = clamp(Math.round(px), minW, maxW);

        // This still drives overlay clamp and the device frame sizing visuals
        frame.style.setProperty("--vpw", w + "px");
        readout.textContent = w + "px";
        setThumb(w);

        // IMPORTANT:
        // Tailwind breakpoints will NOT respond to --vpw.
        // They WILL respond inside an iframe whose viewport width is w.
        setIframeWidth(w);

        const b = bucketForWidth(w);
        setActive(b);

        // Bucket-driven overlay/bg behaviour (outside iframe)
        setOverlayClampForBucket(b);
        setOverlay(b);
        setBg(b);

        state.w = w;
        state.which = forcedLabel || b;
        localStorage.setItem(key, JSON.stringify(state));

        // Try to keep iframe height correct after width changes (content reflows)
        setTimeout(tryAutoIframeHeight, 0);
        setTimeout(tryAutoIframeHeight, 60);
      }

      const presets = { mobile: wMobile, tablet: wTablet, desktop: wDesktop };

      const qs = new URLSearchParams(location.search);
      const qW = Number(qs.get("vpw"));
      const initW =
        Number.isFinite(qW) && qW > 0
          ? qW
          : (Number(state.w) || wDesktop || maxW);

      setWidth(initW, null);

      btnM.addEventListener("click", () => setWidth(presets.mobile, "mobile"));
      btnT.addEventListener("click", () => setWidth(presets.tablet, "tablet"));
      btnD.addEventListener("click", () => setWidth(presets.desktop, "desktop"));

      let dragging = false;

      function clientX(e){
        if (e.touches && e.touches[0]) return e.touches[0].clientX;
        return e.clientX;
      }

      function onMove(e){
        if (!dragging) return;
        const r = rail.getBoundingClientRect();
        const x = clamp(clientX(e) - r.left, 0, r.width);
        const t = r.width ? (x / r.width) : 0;
        const w = minW + t * (maxW - minW);
        setWidth(w, null);
        e.preventDefault();
      }

      function onUp(){
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onUp);
      }

      rail.addEventListener("mousedown", (e) => {
        dragging = true;
        onMove(e);
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      rail.addEventListener("touchstart", (e) => {
        dragging = true;
        onMove(e);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onUp);
      }, { passive: false });

      frame.style.transform = "none";
      frame.style.zoom = "1";

      // If iframe exists, set an initial height once it loads
      if (vpIframe) {
        vpIframe.addEventListener("load", () => {
          tryAutoIframeHeight();
          setTimeout(tryAutoIframeHeight, 80);
        });
      }
    })();
  </script>
`;
}
