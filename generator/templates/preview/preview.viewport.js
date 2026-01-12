// generator/templates/preview/preview.viewport.js

export function viewportScript({ designW, slug }) {
  return `
  <script>
    (function(){
      // -------- Viewport sizing (NO scaling) --------
      const designW = ${JSON.stringify(Number(designW) || 1200)};
      const slug = ${JSON.stringify(String(slug || ""))};
      const key = "previewViewport:" + slug;

      const btnM = document.getElementById("vp_mobile");
      const btnT = document.getElementById("vp_tablet");
      const btnD = document.getElementById("vp_desktop");

      const frame = document.getElementById("device_frame");
      const rail = document.getElementById("vp_rail");
      const thumb = document.getElementById("vp_thumb");
      const readout = document.getElementById("vp_readout");

      if (!frame || !rail || !thumb || !readout || !btnM || !btnT || !btnD) return;

      const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
      const minW = 320;
      const maxW = designW;

      const state = (() => {
        try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
      })();

      function setActive(which){
        btnM.dataset.active = which === "mobile" ? "1" : "0";
        btnT.dataset.active = which === "tablet" ? "1" : "0";
        btnD.dataset.active = which === "desktop" ? "1" : "0";
      }

      function setWidth(px, which){
        const w = clamp(Math.round(px), minW, maxW);
        frame.style.setProperty("--vpw", w + "px");
        readout.textContent = w + "px";

        const r = rail.getBoundingClientRect();
        const t = (w - minW) / (maxW - minW);
        thumb.style.left = (t * r.width) + "px";

        if (which) setActive(which);

        state.w = w;
        state.which = which || state.which || "custom";
        localStorage.setItem(key, JSON.stringify(state));
      }

      const presets = { mobile: 390, tablet: 768, desktop: maxW };

      const qs = new URLSearchParams(location.search);
      const qW = Number(qs.get("vpw"));
      const initW = Number.isFinite(qW) && qW > 0 ? qW : (Number(state.w) || maxW);

      const near = (a,b) => Math.abs(a-b) <= 2;
      let initWhich = state.which || "desktop";
      if (near(initW, presets.mobile)) initWhich = "mobile";
      else if (near(initW, presets.tablet)) initWhich = "tablet";
      else if (near(initW, presets.desktop)) initWhich = "desktop";
      else initWhich = "custom";

      setWidth(initW, initWhich === "custom" ? null : initWhich);

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
    })();
  </script>
`;
}
