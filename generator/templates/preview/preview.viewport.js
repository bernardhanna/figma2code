// generator/templates/preview/preview.viewport.js

export function viewportScript({ designW, slug }) {
  return `
  <script>
    (function(){
      // =========================================================
      // Viewport sizing (NO scaling) + responsive bucket switching
      //
      // Breakpoints (your spec):
      // - mobile:  <= 768
      // - tablet:  769..1084
      // - desktop: >= 1085
      //
      // IMPORTANT:
      // Tailwind breakpoints do NOT respond to changing a div width.
      // So we expose hooks to let preview swap markup + overlay by bucket.
      // =========================================================

      const FALLBACK_DESIGN_W = ${JSON.stringify(Number(designW) || 1200)};
      const slug = ${JSON.stringify(String(slug || ""))};

      // preview.html.js (or another injected script) can set:
      // window.__RESPONSIVE__ = {
      //   groupKey: "Home v3", // shared state across variants
      //   widths: { mobile: 390, tablet: 1084, desktop: 1728 },
      //   breakpoints: { mobileMax: 768, tabletMax: 1084 }
      // };
      const resp = (window.__RESPONSIVE__ && typeof window.__RESPONSIVE__ === "object")
        ? window.__RESPONSIVE__
        : null;

      const groupKey = (resp && typeof resp.groupKey === "string" && resp.groupKey.trim())
        ? resp.groupKey.trim()
        : slug;

      const key = "previewViewport:" + groupKey;

      const btnM = document.getElementById("vp_mobile");
      const btnT = document.getElementById("vp_tablet");
      const btnD = document.getElementById("vp_desktop");

      const frame = document.getElementById("device_frame");
      const rail = document.getElementById("vp_rail");
      const thumb = document.getElementById("vp_thumb");
      const readout = document.getElementById("vp_readout");

      const cmp = document.getElementById("cmp_root");

      if (!frame || !rail || !thumb || !readout || !btnM || !btnT || !btnD) return;

      const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
      const minW = 320;

      // ----- Breakpoints (as per your spec) -----
      const bpMobileMax = Number(resp?.breakpoints?.mobileMax) || 768;
      const bpTabletMax = Number(resp?.breakpoints?.tabletMax) || 1084;

      // ----- Design widths (must match Figma frames) -----
      // These are preset button targets (NOT the breakpoint thresholds).
      const wMobile  = Number(resp?.widths?.mobile)  || 390;
      const wTablet  = Number(resp?.widths?.tablet)  || 1084;
      const wDesktop = Number(resp?.widths?.desktop) || FALLBACK_DESIGN_W;

      // Max resize width should be the desktop design width (not current bucket width)
      const maxW = Math.max(wDesktop, wTablet, wMobile, FALLBACK_DESIGN_W);

      // Expose design clamp for CSS (device frame max width)
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

      function setOverlayClampForBucket(b){
        if (!cmp) return;
        const ow = (b === "mobile") ? wMobile : (b === "tablet") ? wTablet : wDesktop;
        cmp.style.setProperty("--overlay-w", ow + "px");
        cmp.dataset.bucket = b;
      }

      let currentBucket = null;

      // Hook: preview HTML can implement to swap variant markup + overlay
      // window.__onPreviewBucketChange = ({ bucket, widthPx }) => {}
      function notifyBucketChange(nextBucket, w){
        if (typeof window.__onPreviewBucketChange === "function") {
          try { window.__onPreviewBucketChange({ bucket: nextBucket, widthPx: w }); } catch {}
        }
      }

      function setWidth(px, forcedLabel){
        const w = clamp(Math.round(px), minW, maxW);

        frame.style.setProperty("--vpw", w + "px");
        readout.textContent = w + "px";
        setThumb(w);

        const b = bucketForWidth(w);

        // Buttons reflect bucket even when dragging
        setActive(b);

        // Clamp overlay to the *variant* design width for the current bucket
        setOverlayClampForBucket(b);

        state.w = w;
        state.which = forcedLabel || b;
        localStorage.setItem(key, JSON.stringify(state));

        if (b !== currentBucket) {
          currentBucket = b;
          notifyBucketChange(b, w);
        }
      }

      const presets = { mobile: wMobile, tablet: wTablet, desktop: wDesktop };

      // Init width (URL param wins, then stored, then desktop)
      const qs = new URLSearchParams(location.search);
      const qW = Number(qs.get("vpw"));
      const initW =
        Number.isFinite(qW) && qW > 0
          ? qW
          : (Number(state.w) || wDesktop || maxW);

      setWidth(initW, null);

      // Preset buttons jump to *Figma design widths*
      btnM.addEventListener("click", () => setWidth(presets.mobile, "mobile"));
      btnT.addEventListener("click", () => setWidth(presets.tablet, "tablet"));
      btnD.addEventListener("click", () => setWidth(presets.desktop, "desktop"));

      // Drag rail
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

      // Ensure no accidental scaling
      frame.style.transform = "none";
      frame.style.zoom = "1";
    })();
  </script>
`;
}
