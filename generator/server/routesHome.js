// generator/server/routesHome.js

import fs from "node:fs";
import path from "node:path";

import { STAGING_DIR } from "./runtimePaths.js";
import { readConfig } from "./configStore.js";

export function registerHomeRoutes(app) {
  app.get("/", (req, res) => {
    const cfg = readConfig();

    const staged = fs
      .readdirSync(STAGING_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(STAGING_DIR, f), "utf8"));
          return {
            slug: data.slug,
            when: data.when,
            preview: `/preview/${data.slug}`,
            compare: `/api/compare/${data.slug}`,
            diffDir: `/fixtures.out/${data.slug}`,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><body style="font-family:system-ui;padding:24px;max-width:1100px">
      <h1>figma2wp generator (auto-layout)</h1>
      <section style="margin-top:8px;">
        <h2 style="font-size:16px;">Theme Folder</h2>
        <pre style="background:#f6f7f9;padding:8px;border-radius:6px;white-space:pre-wrap">${cfg.themeRoot}</pre>
        <div>
          <input id="pth" placeholder="/path/to/wp-content/themes/your-theme" style="width:100%;padding:8px;margin-top:6px"/>
          <button id="save" style="margin-top:8px">Save</button>
        </div>
      </section>

      <section style="margin-top:24px;">
        <h2 style="font-size:16px;">Staged Previews</h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
          <thead><tr><th>Slug</th><th>When</th><th>Preview</th><th>Compare</th><th>Artifacts</th><th>Actions</th></tr></thead>
          <tbody>
            ${staged.length
        ? staged
          .map(
            (s) => `
                <tr>
                  <td><code>${s.slug}</code></td>
                  <td>${new Date(s.when).toLocaleString()}</td>
                  <td><a href="${s.preview}" target="_blank">Open</a></td>
                  <td>
                    <button onclick="runCompare('${s.slug}')">Run compare</button>
                  </td>
                  <td>
                    <a href="${s.diffDir}/score.json" target="_blank">score.json</a>
                    &nbsp;|&nbsp;
                    <a href="${s.diffDir}/render.png" target="_blank">render.png</a>
                    &nbsp;|&nbsp;
                    <a href="${s.diffDir}/diff.png" target="_blank">diff.png</a>
                  </td>
                  <td><button onclick="delStage('${s.slug}')">Delete</button></td>
                </tr>`
          )
          .join("")
        : '<tr><td colspan="6" style="text-align:center;color:#666">No staged previews yet</td></tr>'}
          </tbody>
        </table>
        <p style="color:#555;margin-top:10px;">
          Compare uses meta.overlay.src (Figma overlay PNG) if present, and writes outputs under <code>generator/fixtures.out/&lt;slug&gt;</code>.
        </p>
      </section>

      <script>
        document.getElementById('save').addEventListener('click', async () => {
          const p = (document.getElementById('pth').value || '').trim();
          if (!p) return alert('Enter a path');
          const r = await fetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ themeRoot: p }) });
          const out = await r.json();
          alert(out.ok ? 'Saved.' : 'Failed: ' + (out.error || 'unknown'));
          location.reload();
        });

        async function delStage(slug) {
          const r = await fetch('/api/staging/' + encodeURIComponent(slug), { method: 'DELETE' });
          const out = await r.json();
          if (out.ok) location.reload();
          else alert('Delete failed: ' + (out.error || 'unknown'));
        }

        async function runCompare(slug) {
          try {
            const r = await fetch('/api/compare/' + encodeURIComponent(slug), { method: 'POST' });
            const out = await r.json();
            if (!out.ok) return alert('Compare failed: ' + (out.error || 'unknown'));
            alert('Compare done: diffRatio ' + (out.score?.diffRatio*100).toFixed(2) + '% ' + (out.score?.pass ? '(PASS)' : '(FAIL)'));
          } catch (e) {
            alert('Compare error: ' + (e && e.message ? e.message : String(e)));
          }
        }
      </script>
    </body></html>`);
  });
}
