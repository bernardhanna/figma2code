// generator/templates/preview/preview.patches.js

export function patchesScript(slug) {
  return `
  <!-- Apply patches (fixtures.out/<slug>/patches.json) -->
  <script>
    (function(){
      const slug = ${JSON.stringify(String(slug || ""))};
      if (!slug) return;

      const PATCH_URL = "/fixtures.out/" + encodeURIComponent(slug) + "/patches.json";

      function asObj(v){ return (v && typeof v === 'object') ? v : null; }

      function applyPatchToEl(el, patch){
        if (!el || !patch) return;

        if (Array.isArray(patch.classAdd)) {
          for (const c of patch.classAdd) {
            const cls = String(c || '').trim();
            if (cls) el.classList.add(cls);
          }
        }

        if (Array.isArray(patch.classRemove)) {
          for (const c of patch.classRemove) {
            const cls = String(c || '').trim();
            if (cls) el.classList.remove(cls);
          }
        }

        if (asObj(patch.classReplace)) {
          for (const from in patch.classReplace) {
            const to = String(patch.classReplace[from] || '').trim();
            const fr = String(from || '').trim();
            if (!fr || !to) continue;
            if (el.classList.contains(fr)) {
              el.classList.remove(fr);
              el.classList.add(to);
            }
          }
        }

        if (asObj(patch.style)) {
          for (const k in patch.style) {
            const v = patch.style[k];
            if (v === null || typeof v === 'undefined') continue;
            try { el.style[k] = String(v); } catch {}
          }
        }
      }

      async function loadPatches(){
        try{
          const r = await fetch(PATCH_URL, { cache: 'no-store' });
          if (!r.ok) return null;
          const json = await r.json();
          return asObj(json) || null;
        } catch {
          return null;
        }
      }

      function applyAll(patches){
        if (!patches) return;

        const nodes = Array.from(document.querySelectorAll('[data-node-id],[data-node]'));

        for (const el of nodes) {
          const id =
            el.getAttribute('data-node-id') ||
            el.getAttribute('data-node') ||
            null;

          if (!id) continue;

          const p = patches[id];
          if (p) applyPatchToEl(el, p);
        }
      }

      (async function init(){
        const patches = await loadPatches();
        if (!patches) return;
        applyAll(patches);
      })();
    })();
  </script>
`;
}
