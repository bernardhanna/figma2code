// generator/templates/preview/preview.patches.js

export function patchesScript() {
  return `
  <script>
    (function(){
      const fallback = (document.body && document.body.getAttribute("data-preview-slug")) || "";
      const allowedStages = ["generate", "codeit", "improve"];
      const safeAria = new Set(["aria-label", "aria-labelledby", "aria-describedby", "aria-hidden"]);

      const getSlug = () =>
        String(window.__CURRENT_PREVIEW_SLUG__ || fallback || "").trim();

      const getStage = () => {
        const qs = new URLSearchParams(location.search);
        const raw = String(qs.get("stage") || "generate").trim().toLowerCase();
        return allowedStages.includes(raw) ? raw : "generate";
      };

      function asObj(v){ return (v && typeof v === 'object') ? v : null; }
      function asArr(v){ return Array.isArray(v) ? v : []; }
      function escapeSelector(v){ return String(v || "").replace(/"/g, '\\"'); }

      function resolveDoc(){
        const iframe = document.getElementById("vp_iframe");
        if (iframe && iframe.contentDocument) return iframe.contentDocument;
        return document;
      }

      function normalizePatchOps(patch){
        if (!patch) return null;
        const ops = asObj(patch.ops) ? patch.ops : patch;
        return {
          classAdd: asArr(ops.classAdd),
          classRemove: asArr(ops.classRemove),
          classReplace: asObj(ops.classReplace) || {},
          attrAdd: asObj(ops.attrAdd) || {},
          attrRemove: asArr(ops.attrRemove),
        };
      }

      function applyPatchToEl(el, patch){
        if (!el || !patch) return;
        const ops = normalizePatchOps(patch);
        if (!ops) return;

        if (ops.classAdd.length) {
          for (const c of ops.classAdd) {
            const cls = String(c || '').trim();
            if (cls) el.classList.add(cls);
          }
        }

        if (ops.classRemove.length) {
          for (const c of ops.classRemove) {
            const cls = String(c || '').trim();
            if (cls) el.classList.remove(cls);
          }
        }

        if (ops.classReplace && typeof ops.classReplace === "object") {
          for (const from in ops.classReplace) {
            const to = String(ops.classReplace[from] || '').trim();
            const fr = String(from || '').trim();
            if (!fr || !to) continue;
            if (el.classList.contains(fr)) {
              el.classList.remove(fr);
              el.classList.add(to);
            }
          }
        }

        if (ops.attrAdd && typeof ops.attrAdd === "object") {
          for (const k in ops.attrAdd) {
            if (!safeAria.has(String(k || "").toLowerCase())) continue;
            const v = ops.attrAdd[k];
            if (v === null || typeof v === 'undefined') continue;
            try { el.setAttribute(k, String(v)); } catch {}
          }
        }

        if (ops.attrRemove && ops.attrRemove.length) {
          for (const k of ops.attrRemove) {
            if (!safeAria.has(String(k || "").toLowerCase())) continue;
            try { el.removeAttribute(k); } catch {}
          }
        }
      }

      function resolveElement(doc, patch){
        const selector = String(patch.selector || "").trim();
        if (selector) {
          try {
            const el = doc.querySelector(selector);
            if (el) return el;
          } catch {}
        }
        const nodeId = String(patch.nodeId || "").trim();
        if (!nodeId) return null;
        const escaped = escapeSelector(nodeId);
        return (
          doc.querySelector('[data-node-id="' + escaped + '"]') ||
          doc.querySelector('[data-key="' + escaped + '"]')
        );
      }

      async function loadStageArtifact(slug, stage){
        try{
          const url = "/fixtures.out/" + encodeURIComponent(slug) + "/artifact." + stage + ".json";
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) return null;
          const json = await r.json();
          return asObj(json) || null;
        } catch {
          return null;
        }
      }

      async function loadUserPatches(slug){
        try{
          const url = "/fixtures.out/" + encodeURIComponent(slug) + "/patches.user.json";
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) return null;
          const json = await r.json();
          return asObj(json) || null;
        } catch {
          return null;
        }
      }

      function normalizePatchList(patches){
        if (!patches) return;
        if (Array.isArray(patches)) return patches;
        if (asObj(patches)) {
          return Object.keys(patches).map((nodeId) => ({
            nodeId,
            ops: patches[nodeId],
          }));
        }
        return [];
      }

      function applyAll(doc, patches, stage){
        const list = normalizePatchList(patches);
        if (!list || !list.length) return;
        for (const patch of list) {
          if (patch && patch.stage && patch.stage !== stage) continue;
          const el = resolveElement(doc, patch);
          if (!el) continue;
          applyPatchToEl(el, patch);
        }
      }

      async function applyCurrent(){
        const slug = getSlug();
        if (!slug) return;
        const stage = getStage();
        const doc = resolveDoc();
        if (!doc) return;

        const artifact = await loadStageArtifact(slug, stage);
        if (artifact && artifact.patches) {
          applyAll(doc, artifact.patches, stage);
        }

        const user = await loadUserPatches(slug);
        if (user && user.patches) {
          applyAll(doc, user.patches, stage);
        }
      }

      // expose for responsive swapper
      window.__applyPatchesForCurrentSlug__ = applyCurrent;
      window.__patchHelpers__ = {
        loadStageArtifact,
        loadUserPatches,
        applyAll,
        normalizePatchOps,
        resolveDoc,
        getStage,
      };

      const iframe = document.getElementById("vp_iframe");
      if (iframe) {
        iframe.addEventListener("load", () => applyCurrent());
        setTimeout(() => applyCurrent(), 0);
      } else {
        applyCurrent();
      }
    })();
  </script>
  `;
}
