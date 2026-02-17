// generator/templates/preview/preview.patches.js

export function resolvePatchUrls(slug, bucket) {
  const safeSlug = encodeURIComponent(String(slug || "").trim());
  const safeBucket = String(bucket || "").trim().toLowerCase();
  const generic = `/fixtures.out/${safeSlug}/patches.json`;
  const bucketSpecific = safeBucket ? `/fixtures.out/${safeSlug}/patches.${safeBucket}.json` : "";
  return { bucketSpecific, generic };
}

export function mergePatchMaps(baseMap, overrideMap) {
  const base = baseMap && typeof baseMap === "object" ? baseMap : {};
  const over = overrideMap && typeof overrideMap === "object" ? overrideMap : {};
  const out = JSON.parse(JSON.stringify(base));

  for (const nodeId of Object.keys(over)) {
    const src = over[nodeId] && typeof over[nodeId] === "object" ? over[nodeId] : {};
    const dst = out[nodeId] && typeof out[nodeId] === "object" ? out[nodeId] : {};
    const merged = { ...dst };

    const add = []
      .concat(Array.isArray(dst.classAdd) ? dst.classAdd : [])
      .concat(Array.isArray(src.classAdd) ? src.classAdd : []);
    const remove = []
      .concat(Array.isArray(dst.classRemove) ? dst.classRemove : [])
      .concat(Array.isArray(src.classRemove) ? src.classRemove : []);
    const replace = { ...(dst.classReplace || {}), ...(src.classReplace || {}) };
    const style = { ...(dst.style || {}), ...(src.style || {}) };
    const attrAdd = { ...(dst.attrAdd || {}), ...(src.attrAdd || {}) };
    const attrRemove = []
      .concat(Array.isArray(dst.attrRemove) ? dst.attrRemove : [])
      .concat(Array.isArray(src.attrRemove) ? src.attrRemove : []);

    if (add.length) merged.classAdd = Array.from(new Set(add.map((x) => String(x || "").trim()).filter(Boolean)));
    if (remove.length) merged.classRemove = Array.from(new Set(remove.map((x) => String(x || "").trim()).filter(Boolean)));
    if (Object.keys(replace).length) merged.classReplace = replace;
    if (Object.keys(style).length) merged.style = style;
    if (Object.keys(attrAdd).length) merged.attrAdd = attrAdd;
    if (attrRemove.length) merged.attrRemove = Array.from(new Set(attrRemove));

    out[nodeId] = merged;
  }

  return out;
}

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
      function markPatchReady(ready, count){
        const isReady = !!ready;
        const n = Number.isFinite(Number(count)) ? Number(count) : Number(window.__PATCHES_APPLIED_COUNT__ || 0);
        window.__PATCHES_READY__ = isReady;
        window.__PATCHES_APPLIED_COUNT__ = n;
        try {
          const iframe = document.getElementById("vp_iframe");
          const w = iframe && iframe.contentWindow ? iframe.contentWindow : null;
          if (w) {
            w.__PATCHES_READY__ = isReady;
            w.__PATCHES_APPLIED_COUNT__ = n;
          }
        } catch {}
      }

      function normalizePatchOps(patch){
        if (!patch) return null;
        const ops = asObj(patch.ops) ? patch.ops : patch;
        return {
          classAdd: asArr(ops.classAdd),
          classRemove: asArr(ops.classRemove),
          classReplace: asObj(ops.classReplace) || {},
          style: asObj(ops.style) || {},
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

        if (ops.style && typeof ops.style === "object") {
          for (const k in ops.style) {
            const key = String(k || "").trim();
            const val = String(ops.style[k] || "").trim();
            if (!key || !val) continue;
            try { el.style.setProperty(key, val); } catch {}
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

      async function loadBucketPatchMap(slug, bucket){
        const safeBucket = String(bucket || "").trim().toLowerCase();
        const urls = ${JSON.stringify({})};
        function resolveUrls(s, b){
          const safeSlug = encodeURIComponent(String(s || "").trim());
          const generic = "/fixtures.out/" + safeSlug + "/patches.json";
          const bucketSpecific = b ? "/fixtures.out/" + safeSlug + "/patches." + b + ".json" : "";
          return { bucketSpecific, generic };
        }
        const u = resolveUrls(slug, safeBucket);

        async function loadMap(url){
          if (!url) return null;
          try{
            const r = await fetch(url, { cache: "no-store" });
            if (!r.ok) return null;
            const json = await r.json();
            return asObj(json) || null;
          } catch { return null; }
        }

        const [bucketMap, genericMap] = await Promise.all([
          loadMap(u.bucketSpecific),
          loadMap(u.generic),
        ]);
        return { bucketMap: bucketMap || {}, genericMap: genericMap || {} };
      }

      function mergePatchMapsLocal(baseMap, overrideMap){
        const base = asObj(baseMap) || {};
        const over = asObj(overrideMap) || {};
        const out = JSON.parse(JSON.stringify(base));
        for (const nodeId of Object.keys(over)) {
          const src = asObj(over[nodeId]) || {};
          const dst = asObj(out[nodeId]) || {};
          const merged = { ...dst };

          const add = []
            .concat(Array.isArray(dst.classAdd) ? dst.classAdd : [])
            .concat(Array.isArray(src.classAdd) ? src.classAdd : []);
          const remove = []
            .concat(Array.isArray(dst.classRemove) ? dst.classRemove : [])
            .concat(Array.isArray(src.classRemove) ? src.classRemove : []);
          const replace = { ...(asObj(dst.classReplace) || {}), ...(asObj(src.classReplace) || {}) };
          const style = { ...(asObj(dst.style) || {}), ...(asObj(src.style) || {}) };
          const attrAdd = { ...(asObj(dst.attrAdd) || {}), ...(asObj(src.attrAdd) || {}) };
          const attrRemove = []
            .concat(Array.isArray(dst.attrRemove) ? dst.attrRemove : [])
            .concat(Array.isArray(src.attrRemove) ? src.attrRemove : []);

          if (add.length) merged.classAdd = Array.from(new Set(add.map((x) => String(x || "").trim()).filter(Boolean)));
          if (remove.length) merged.classRemove = Array.from(new Set(remove.map((x) => String(x || "").trim()).filter(Boolean)));
          if (Object.keys(replace).length) merged.classReplace = replace;
          if (Object.keys(style).length) merged.style = style;
          if (Object.keys(attrAdd).length) merged.attrAdd = attrAdd;
          if (attrRemove.length) merged.attrRemove = Array.from(new Set(attrRemove));

          out[nodeId] = merged;
        }
        return out;
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
        if (!list || !list.length) return 0;
        let appliedCount = 0;
        for (const patch of list) {
          if (patch && patch.stage && patch.stage !== stage) continue;
          const el = resolveElement(doc, patch);
          if (!el) continue;
          applyPatchToEl(el, patch);
          appliedCount += 1;
        }
        return appliedCount;
      }

      async function applyCurrent(){
        markPatchReady(false, 0);
        const slug = getSlug();
        if (!slug) { markPatchReady(true, 0); return; }
        const stage = getStage();
        const doc = resolveDoc();
        if (!doc) { markPatchReady(true, 0); return; }
        const cmpRoot = document.getElementById("cmp_root");
        const bucket = String(cmpRoot?.dataset?.bucket || "desktop").trim().toLowerCase();
        let appliedCount = 0;

        const artifact = await loadStageArtifact(slug, stage);
        if (artifact && artifact.patches) {
          appliedCount += applyAll(doc, artifact.patches, stage);
        }

        const user = await loadUserPatches(slug);
        if (user && user.patches) {
          appliedCount += applyAll(doc, user.patches, stage);
        }

        const loaded = await loadBucketPatchMap(slug, bucket);
        const mergedRefine = mergePatchMapsLocal(loaded.genericMap, loaded.bucketMap);
        if (mergedRefine && Object.keys(mergedRefine).length) {
          appliedCount += applyAll(doc, mergedRefine, stage);
        }
        markPatchReady(true, appliedCount);
      }

      // expose for responsive swapper
      window.__applyPatchesForCurrentSlug__ = applyCurrent;
      window.applyPatchesForCurrentSlug = applyCurrent;
      window.__patchHelpers__ = {
        loadStageArtifact,
        loadUserPatches,
        applyAll,
        normalizePatchOps,
        resolveDoc,
        getStage,
        mergePatchMaps: mergePatchMapsLocal,
      };
      markPatchReady(false, 0);

      const previousBucketHook =
        typeof window.__onPreviewBucketChange === "function" ? window.__onPreviewBucketChange : null;
      window.__onPreviewBucketChange = function(payload){
        try {
          if (previousBucketHook) previousBucketHook(payload);
        } finally {
          applyCurrent().catch(() => {
            markPatchReady(true, 0);
          });
        }
      };

      const iframe = document.getElementById("vp_iframe");
      if (iframe) {
        iframe.addEventListener("load", () => {
          applyCurrent().catch(() => {
            markPatchReady(true, 0);
          });
        });
        setTimeout(() => {
          applyCurrent().catch(() => {
            markPatchReady(true, 0);
          });
        }, 0);
      } else {
        applyCurrent().catch(() => {
          markPatchReady(true, 0);
        });
      }
    })();
  </script>
  `;
}
