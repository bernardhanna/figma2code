// generator/templates/preview/preview.overlay.js

import { escapeHtml } from "./preview.util.js";

export function overlayBlock({ slug, overlaySrc }) {
  const safeSlug = String(slug || "");
  const safeOverlay = String(overlaySrc || "");

  return `
  <div id="score_modal_backdrop" class="modal-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="score_modal_title">
      <div class="modal-hd">
        <div>
          <div id="score_modal_title" class="modal-title">Visual diff scores</div>
          <div class="modal-sub">
            Slug: <span class="mono">${escapeHtml(safeSlug)}</span>
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

      const cmp = document.getElementById('cmp_root');
      const img = document.getElementById('ov_img');
      const enabled = document.getElementById('ov_enabled');
      const opacity = document.getElementById('ov_opacity');
      const opacityVal = document.getElementById('ov_opacity_val');
      const diff = document.getElementById('ov_diff');
      const reset = document.getElementById('ov_reset');

      if (!cmp || !img) return;

      const key = 'figmaOverlay:' + ${JSON.stringify(safeSlug)};
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

        // Apply via vars (for tooling)...
        cmp.style.setProperty('--oop', String(op));
        cmp.style.setProperty('--obm', mode);

        // ...AND apply directly to the overlay image (for reliability)
        img.style.opacity = String(op);
        img.style.mixBlendMode = mode;

        // ensure paint
        void img.offsetHeight;

        if (opacityVal && opacity) opacityVal.textContent = String(opacity.value || '0') + '%';
      }

      // init controls from state
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

      // ---------------- Scores modal ----------------
      const scoreBtn = document.getElementById('ov_scores');
      const modalBackdrop = document.getElementById('score_modal_backdrop');
      const modalClose = document.getElementById('score_modal_close');
      const runCompareBtn = document.getElementById('score_run_compare');
      const refreshBtn = document.getElementById('score_refresh');

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

      const slug = ${JSON.stringify(safeSlug)};

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

        const base = \`/fixtures.out/\${encodeURIComponent(slug)}\`;
        if (scoreEls.linkScore) scoreEls.linkScore.href = \`\${base}/score.json\`;
        if (scoreEls.linkFigma) scoreEls.linkFigma.href = \`\${base}/figma.png\`;
        if (scoreEls.linkRender) scoreEls.linkRender.href = \`\${base}/render.png\`;
        if (scoreEls.linkDiff) scoreEls.linkDiff.href = \`\${base}/diff.png\`;
      }

      async function loadLatestScore(){
        try{
          const r = await fetch(\`/fixtures.out/\${encodeURIComponent(slug)}/score.json\`, { cache: 'no-store' });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      }

      async function runCompare(){
        const body = { waitMs: 350, screenshot: { mode: "element", selector: "#cmp_root", minHeight: 50 } };

        const r = await fetch(\`/api/compare/\${encodeURIComponent(slug)}\`, {
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
`;
}
