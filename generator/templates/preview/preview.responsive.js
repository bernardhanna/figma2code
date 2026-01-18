// generator/templates/preview/preview.responsive.js
//
// MERGED-SAFE RESPONSIVE RUNTIME
// ---------------------------------------------
// This script is ONLY responsible for:
// - providing window.__RESPONSIVE__ so preview.viewport.js can use figma widths
// - providing a minimal window.__onPreviewBucketChange hook
//
// IMPORTANT: In merged responsive mode we MUST NOT fetch variant HTML
// and MUST NOT replace .content-layer innerHTML.
// Tailwind should respond naturally as the preview width changes.
//
// If you still want variant swapping for legacy mode, keep the old file
// under a different name (e.g. preview.responsive.legacy.js) and only inject it
// when !isMergedGroup.

export function responsiveScript({
  slug,
  frameName,
  designW,
  // Optional: pass real figma widths if you have them
  widths = { mobile: 390, tablet: 1084, desktop: designW },
  breakpoints = { mobileMax: 768, tabletMax: 1084 },
  // Optional: groupKey override (if you already computed it)
  groupKey: groupKeyOverride,
  // Optional: mergedGroup flag (if you want to tag this mode)
  mergedGroup = false,
} = {}) {
  const safeSlug = String(slug || "").trim();

  return `
  <script>
    (function(){
      const CURRENT_SLUG = ${JSON.stringify(safeSlug)};
      const FRAME_NAME = ${JSON.stringify(String(frameName || ""))};

      // Derive groupKey from frame name "Home v3@desktop" => "Home v3"
      const derivedGroupKey = (function(){
        const s = String(FRAME_NAME || "").trim();
        if (!s) return CURRENT_SLUG;
        const m = s.match(/^(.*)@([a-zA-Z]+)\\s*$/);
        if (m && m[1]) return String(m[1]).trim() || CURRENT_SLUG;
        return CURRENT_SLUG;
      })();

      const groupKey = ${JSON.stringify(String(groupKeyOverride || "").trim())} || derivedGroupKey;

      // In merged mode we keep scoring/patches scoped to the groupKey
      window.__CURRENT_PREVIEW_SLUG__ = ${JSON.stringify(Boolean(mergedGroup))} ? groupKey : CURRENT_SLUG;

      // Expose responsive config so preview.viewport.js can use figma widths and breakpoints
      window.__RESPONSIVE__ = {
        groupKey,
        widths: ${JSON.stringify(widths)},
        breakpoints: ${JSON.stringify(breakpoints)},
        mergedGroup: ${JSON.stringify(Boolean(mergedGroup))}
      };

      // -------------------------------------------------------------------
      // Minimal bucket-change hook:
      // - NEVER swaps HTML
      // - ONLY updates dataset + overlay/background assets if available
      // -------------------------------------------------------------------
      window.__onPreviewBucketChange = function({ bucket }){
        const b = String(bucket || "").toLowerCase();

        const cmp = document.getElementById("cmp_root");
        if (cmp) cmp.dataset.bucket = b;

        // Optional: background switching via data-group-bg-* attributes
        const bgLayer = document.getElementById("bg_layer");
        if (cmp && bgLayer) {
          const fit = cmp.getAttribute("data-bg-fit") || "cover";
          const pos = cmp.getAttribute("data-bg-pos") || "center";
          const bg =
            b === "mobile" ? (cmp.getAttribute("data-group-bg-mobile") || "") :
            b === "tablet" ? (cmp.getAttribute("data-group-bg-tablet") || cmp.getAttribute("data-group-bg-desktop") || "") :
            (cmp.getAttribute("data-group-bg-desktop") || "");

          if (bg) {
            bgLayer.style.display = "block";
            bgLayer.style.backgroundImage = "url(" + JSON.stringify(String(bg)) + ")";
            bgLayer.style.backgroundSize = String(fit);
            bgLayer.style.backgroundPosition = String(pos);
            bgLayer.style.backgroundRepeat = "no-repeat";
          } else {
            bgLayer.style.backgroundImage = "";
            bgLayer.style.display = "none";
          }
        }

        // Optional: overlay switching via data-group-ov-* attributes
        const ovImg = document.getElementById("ov_img");
        if (ovImg) {
          const ov =
            b === "mobile" ? (ovImg.getAttribute("data-group-ov-mobile") || "") :
            b === "tablet" ? (ovImg.getAttribute("data-group-ov-tablet") || ovImg.getAttribute("data-group-ov-desktop") || "") :
            (ovImg.getAttribute("data-group-ov-desktop") || "");

          // Only swap if we have something meaningful
          if (ov) ovImg.src = ov;
        }
      };
    })();
  </script>
  `;
}
