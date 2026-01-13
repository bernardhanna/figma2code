// generator/templates/preview/preview.responsive.js

export function responsiveScript({
  slug,
  frameName,
  designW,
  overlayW,
  overlaySrc,
  // Optional: pass real figma widths if you have them
  widths = { mobile: 390, tablet: 1084, desktop: designW },
  breakpoints = { mobileMax: 768, tabletMax: 1084 },
} = {}) {
  return `
  <script>
    (function(){
      // ------------------------------------------------------------
      // Responsive preview runtime
      // - Provides window.__RESPONSIVE__ for preview.viewport.js
      // - Implements window.__onPreviewBucketChange(bucket) hook
      //   to swap markup + overlay on a single preview screen.
      // ------------------------------------------------------------

      const CURRENT_SLUG = ${JSON.stringify(String(slug || ""))};
      const FRAME_NAME = ${JSON.stringify(String(frameName || ""))};

      // Use "Home v3" group key from "Home v3@desktop" (your naming convention)
      const groupKey = (function(){
        const s = String(FRAME_NAME || "").trim();
        if (!s) return CURRENT_SLUG;
        const m = s.match(/^(.*)@([a-zA-Z]+)\\s*$/);
        if (m && m[1]) return String(m[1]).trim() || CURRENT_SLUG;
        return CURRENT_SLUG;
      })();

      // Expose the current active slug so other scripts (scores) can follow swaps.
      window.__CURRENT_PREVIEW_SLUG__ = CURRENT_SLUG;

      // Expose responsive config so preview.viewport.js can use figma widths.
      window.__RESPONSIVE__ = {
        groupKey,
        widths: ${JSON.stringify(widths)},
        breakpoints: ${JSON.stringify(breakpoints)},
      };

      // DOM handles
      const contentEl = document.querySelector(".content-layer");
      const ovImg = document.getElementById("ov_img");
      const cmp = document.getElementById("cmp_root");

      // Seed overlay width for the currently rendered page
      if (cmp) cmp.style.setProperty("--ov-w", ${JSON.stringify(
        Number(overlayW) || Number(designW) || 1200
      )} + "px");

      const cache = new Map(); // variant -> payload

      function parseHtml(html){
        const parser = new DOMParser();
        const doc = parser.parseFromString(String(html || ""), "text/html");

        const layer = doc.querySelector(".content-layer");
        const htmlInner = layer ? layer.innerHTML : "";

        const ov = doc.getElementById("ov_img");
        const nextOverlaySrc = ov ? (ov.getAttribute("src") || "") : "";

        // If we include meta tags later, these can be read. For now optional.
        const metaOverlayW = doc.querySelector('meta[name="preview:overlayW"]')?.getAttribute("content") || "";
        const metaSlug = doc.querySelector('meta[name="preview:slug"]')?.getAttribute("content") || "";

        return {
          htmlInner,
          overlaySrc: nextOverlaySrc,
          overlayW: Number(metaOverlayW) || 0,
          slug: String(metaSlug || "").trim(),
        };
      }

      function guessVariantSlug(variant){
        // Best-effort conventions:
        // 1) If current slug has @desktop/@mobile etc, swap suffix.
        // 2) Else try appending: _mobile, _tablet, _desktop and -mobile etc.
        const v = String(variant || "").toLowerCase();
        const s = String(CURRENT_SLUG);

        if (/@(desktop|tablet|mobile)\\s*$/i.test(s)) {
          return s.replace(/@(desktop|tablet|mobile)\\s*$/i, "@" + v);
        }

        // You may be using slugs like "home_v3" then "home_v3_mobile"
        const base = s;
        if (v === "desktop") return base; // keep default as-is
        return base + "_" + v;
      }

      function candidateSlugs(variant){
        const v = String(variant || "").toLowerCase();
        const out = [];

        // 1) @suffix swap if applicable
        out.push(guessVariantSlug(v));

        // 2) common alternatives
        const base = String(CURRENT_SLUG);
        if (v === "desktop") {
          out.push(base + "_desktop");
          out.push(base + "-desktop");
        } else {
          out.push(base + "_" + v);
          out.push(base + "-" + v);
        }

        // 3) groupKey-based options (if slug differs from frame naming)
        const g = String(groupKey);
        if (g && g !== base) {
          if (v === "desktop") {
            out.push(g);
            out.push(g + "_desktop");
            out.push(g + "-desktop");
          } else {
            out.push(g + "_" + v);
            out.push(g + "-" + v);
            out.push(g + "@" + v);
          }
        }

        // de-dupe
        return Array.from(new Set(out.filter(Boolean)));
      }

      async function fetchVariant(slug){
        const url = "/preview/" + encodeURIComponent(slug) + "?embed=1&toolbar=0";
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("Fetch failed: " + r.status);
        return await r.text();
      }

      async function loadVariant(variant){
        const v = String(variant || "").toLowerCase();
        if (cache.has(v)) return cache.get(v);

        const slugs = candidateSlugs(v);
        for (const s of slugs) {
          try{
            const html = await fetchVariant(s);
            const parsed = parseHtml(html);

            const payload = {
              variant: v,
              slug: parsed.slug || s,
              htmlInner: parsed.htmlInner,
              overlaySrc: parsed.overlaySrc || "",
              overlayW: parsed.overlayW || 0,
            };
            cache.set(v, payload);
            return payload;
          } catch {
            // try next candidate
          }
        }
        return null;
      }

      function applyPayload(payload){
        if (!payload) return;

        if (contentEl && typeof payload.htmlInner === "string" && payload.htmlInner.length) {
          contentEl.innerHTML = payload.htmlInner;
        }

        if (payload.slug) window.__CURRENT_PREVIEW_SLUG__ = payload.slug;

        if (ovImg && payload.overlaySrc) {
          ovImg.setAttribute("src", payload.overlaySrc);
        }

        // Set overlay width if we know it; otherwise keep existing.
        if (cmp) {
          const ow = Number(payload.overlayW);
          if (ow > 0) cmp.style.setProperty("--ov-w", ow + "px");
        }
      }

      // Called by preview.viewport.js when bucket changes
      window.__onPreviewBucketChange = async function({ bucket }){
        const b = String(bucket || "").toLowerCase();

        // Tablet fallback: try tablet first, then desktop.
        const order =
          b === "tablet" ? ["tablet", "desktop"] :
          b === "mobile" ? ["mobile"] :
          ["desktop"];

        for (const v of order) {
          const payload = await loadVariant(v);
          if (payload) { applyPayload(payload); return; }
        }
      };
    })();
  </script>
  `;
}
