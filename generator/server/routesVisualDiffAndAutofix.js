// generator/server/routesVisualDiffAndAutofix.js

import fs from "node:fs";
import path from "node:path";

import { VDIFF_DIR } from "./runtimePaths.js";
import { readStage } from "./stageStore.js";

import { loadCompareDeps } from "./visualDiffDeps.js";
import { stableElementScreenshot, absUrl, cropToMin } from "./visualDiffScreenshot.js";
import { captureLayoutJson } from "./visualDiffLayoutCapture.js";
import { readRules, findClassReplaceRule } from "./learnedRulesStore.js";
import { ensurePatchesFile } from "./patchesStore.js";

import { computeElementDiff } from "../auto/elementDiff.js";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function viewportPresets(figmaW, figmaH, tabletMax = 1024) {
  const desktopW = Math.max(1, Math.round(figmaW || 1440));
  const desktopH = Math.max(1, Math.round(figmaH || 900));

  const baseH = Math.max(desktopH + 140, 900);

  return [
    { key: "mobile", viewport: { width: Math.min(768, desktopW), height: baseH } },
    { key: "tablet", viewport: { width: Math.min(tabletMax, desktopW), height: baseH } },
    { key: "desktop", viewport: { width: desktopW, height: baseH } },
  ];
}

export function registerVisualDiffAndAutofixRoutes(app, { port }) {
  app.post("/api/layout/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const { chromium } = await loadCompareDeps();

      const outDir = path.join(VDIFF_DIR, slug);
      ensureDir(outDir);

      const viewport = req.body?.viewport && typeof req.body.viewport === "object" ? req.body.viewport : null;
      const waitMs = typeof req.body?.waitMs === "number" ? req.body.waitMs : 200;

      const layout = await captureLayoutJson({ chromium, slug, port, outDir, viewport, waitMs });
      return res.json({ ok: true, count: layout.length, path: `/fixtures.out/${slug}/layout.json` });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/compare/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const staged = readStage(slug);
      if (!staged?.ast) {
        return res.status(404).json({
          ok: false,
          error: `No staged AST for "${slug}". Run preview once so ../.preview/staging/${slug}.json exists.`,
        });
      }

      const serverUrl = `http://127.0.0.1:${port}`;
      // IMPORTANT: force overlay OFF for compare runs
      const previewUrl = `${serverUrl}/preview/${encodeURIComponent(slug)}?ov=0`;

      const shotCfg = req.body?.screenshot && typeof req.body.screenshot === "object" ? req.body.screenshot : null;

      const selector = String(shotCfg?.selector || req.body?.selector || req.query?.selector || "#cmp_root");

      const minHeight =
        typeof shotCfg?.minHeight === "number"
          ? shotCfg.minHeight
          : typeof req.body?.minHeight === "number"
            ? req.body.minHeight
            : typeof req.query?.minHeight === "string"
              ? Number(req.query.minHeight)
              : 200;

      const waitMs =
        typeof req.body?.waitMs === "number"
          ? req.body.waitMs
          : typeof req.query?.waitMs === "string"
            ? Number(req.query.waitMs)
            : 200;

      const overlaySrc = String(staged?.ast?.meta?.overlay?.src || "").trim();
      if (!overlaySrc) {
        return res.status(400).json({
          ok: false,
          error:
            `Missing ast.meta.overlay.src for "${slug}". ` +
            `Export/store the Figma raster overlay (png) in ast.meta.overlay.src (URL or /assets/... path).`,
        });
      }

      const figmaUrl = absUrl(serverUrl, overlaySrc);

      const { PNG, pixelmatch, chromium } = await loadCompareDeps();

      const outDir = path.join(VDIFF_DIR, slug);
      ensureDir(outDir);

      ensurePatchesFile(outDir);

      const figmaPath = path.join(outDir, "figma.png");
      const renderPath = path.join(outDir, "render.png");
      const diffPath = path.join(outDir, "diff.png");
      const scorePath = path.join(outDir, "score.json");
      const elementDiffPath = path.join(outDir, "element-diff.json");

      const multi = req.body?.multi === true || req.body?.viewports === "all";
      const tabletMax = typeof req.body?.tabletMax === "number" && req.body.tabletMax > 0 ? req.body.tabletMax : 1024;

      const figmaResp = await fetch(figmaUrl);
      if (!figmaResp.ok) {
        return res.status(500).json({
          ok: false,
          error: `Failed to fetch overlay image: ${figmaUrl} (status ${figmaResp.status})`,
        });
      }
      const figmaBuf = Buffer.from(await figmaResp.arrayBuffer());
      fs.writeFileSync(figmaPath, figmaBuf);

      const figmaPng = PNG.sync.read(fs.readFileSync(figmaPath));

      const threshold = typeof req.body?.threshold === "number" ? req.body.threshold : 0.1;
      const includeAA = req.body?.includeAA !== false;
      const passDiffRatio = typeof req.body?.passDiffRatio === "number" ? req.body.passDiffRatio : 0.03;

      const singleViewport =
        req.body?.viewport && typeof req.body.viewport === "object" && Number(req.body.viewport.width) > 0
          ? req.body.viewport
          : null;

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();

        async function runCompareOne(key, viewport) {
          const shot = await stableElementScreenshot(page, previewUrl, selector, viewport, waitMs, minHeight);

          const rPath = key ? path.join(outDir, `render.${key}.png`) : renderPath;
          const dPath = key ? path.join(outDir, `diff.${key}.png`) : diffPath;
          const sPath = key ? path.join(outDir, `score.${key}.json`) : scorePath;

          fs.writeFileSync(rPath, shot.buffer);
          const shotMeta = shot.meta;

          const renderPng = PNG.sync.read(fs.readFileSync(rPath));
          const { w, h, ac: figmaCrop, bc: renderCrop } = cropToMin(PNG, figmaPng, renderPng);
          const diff = new PNG({ width: w, height: h });

          const diffPixels = pixelmatch(figmaCrop.data, renderCrop.data, diff.data, w, h, {
            threshold,
            includeAA,
          });

          fs.writeFileSync(dPath, PNG.sync.write(diff));

          const totalPixels = w * h;
          const diffRatio = totalPixels ? diffPixels / totalPixels : 1;

          const score = {
            slug,
            url: previewUrl,
            viewport,
            screenshot: shotMeta,
            figma: { path: figmaPath, width: figmaPng.width, height: figmaPng.height, src: overlaySrc },
            render: { path: rPath, width: renderPng.width, height: renderPng.height },
            compared: { width: w, height: h },
            compare: { threshold, includeAA, passDiffRatio },
            diffPixels,
            totalPixels,
            diffRatio,
            pass: diffRatio <= passDiffRatio,
            at: new Date().toISOString(),
            mode: key || "single",
          };

          fs.writeFileSync(sPath, JSON.stringify(score, null, 2), "utf8");

          return {
            score,
            artifacts: {
              figma: `/fixtures.out/${encodeURIComponent(slug)}/figma.png`,
              render: `/fixtures.out/${encodeURIComponent(slug)}/${key ? `render.${key}.png` : "render.png"}`,
              diff: `/fixtures.out/${encodeURIComponent(slug)}/${key ? `diff.${key}.png` : "diff.png"}`,
              score: `/fixtures.out/${encodeURIComponent(slug)}/${key ? `score.${key}.json` : "score.json"}`,
            },
          };
        }

        if (!multi) {
          const viewport =
            singleViewport || {
              width: figmaPng.width,
              height: Math.max(figmaPng.height + 140, 900),
            };

          const result = await runCompareOne(null, viewport);

          try {
            const layout = await captureLayoutJson({ chromium, slug, port, outDir, viewport, waitMs: 50 });
            computeElementDiff(diffPath, layout, elementDiffPath);
          } catch (e) {
            console.warn("[autofix] element-diff computation failed:", String(e?.message || e));
          }

          return res.json({
            ok: true,
            score: result.score,
            artifacts: {
              ...result.artifacts,
              layout: `/fixtures.out/${encodeURIComponent(slug)}/layout.json`,
              elementDiff: `/fixtures.out/${encodeURIComponent(slug)}/element-diff.json`,
              patches: `/fixtures.out/${encodeURIComponent(slug)}/patches.json`,
            },
          });
        }

        const presets = viewportPresets(figmaPng.width, figmaPng.height, tabletMax);
        const results = {};

        for (const p of presets) {
          results[p.key] = await runCompareOne(p.key, p.viewport);
        }

        fs.copyFileSync(path.join(outDir, "render.desktop.png"), renderPath);
        fs.copyFileSync(path.join(outDir, "diff.desktop.png"), diffPath);
        fs.copyFileSync(path.join(outDir, "score.desktop.json"), scorePath);

        fs.writeFileSync(
          path.join(outDir, "score.all.json"),
          JSON.stringify({ slug, at: new Date().toISOString(), results }, null, 2),
          "utf8"
        );

        return res.json({
          ok: true,
          slug,
          results,
          artifacts: {
            all: `/fixtures.out/${encodeURIComponent(slug)}/score.all.json`,
            figma: `/fixtures.out/${encodeURIComponent(slug)}/figma.png`,
            render: `/fixtures.out/${encodeURIComponent(slug)}/render.png`,
            diff: `/fixtures.out/${encodeURIComponent(slug)}/diff.png`,
            score: `/fixtures.out/${encodeURIComponent(slug)}/score.json`,
            patches: `/fixtures.out/${encodeURIComponent(slug)}/patches.json`,
          },
        });
      } finally {
        await browser.close();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // AutoFix endpoint unchanged from your version…
  app.post("/api/autofix/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const outDir = path.join(VDIFF_DIR, slug);
      ensureDir(outDir);

      const patchesPath = ensurePatchesFile(outDir);
      const elementDiffPath = path.join(outDir, "element-diff.json");
      const layoutPath = path.join(outDir, "layout.json");

      if (!fs.existsSync(elementDiffPath)) {
        return res.status(400).json({
          ok: false,
          error: `Missing element-diff.json for "${slug}". Run /api/compare/${slug} first.`,
        });
      }

      const offenders = JSON.parse(fs.readFileSync(elementDiffPath, "utf8") || "[]");
      if (!Array.isArray(offenders) || offenders.length === 0) {
        return res.json({ ok: true, message: "No offenders (already clean or no diff data)." });
      }

      const top = offenders[0];
      const patches = JSON.parse(fs.readFileSync(patchesPath, "utf8") || "{}");

      if (fs.existsSync(layoutPath)) {
        try {
          const layout = JSON.parse(fs.readFileSync(layoutPath, "utf8") || "[]");
          const topEl = Array.isArray(layout) ? layout.find((x) => x?.nodeId === top.nodeId) : null;
          const tokens = String(topEl?.className || "").split(/\s+/).filter(Boolean);

          const rules = readRules();
          const learned = findClassReplaceRule(rules, tokens);

          if (learned) {
            patches[top.nodeId] = patches[top.nodeId] || {};
            patches[top.nodeId].classReplace = patches[top.nodeId].classReplace || {};
            patches[top.nodeId].classReplace[learned.from] = learned.to;

            fs.writeFileSync(patchesPath, JSON.stringify(patches, null, 2), "utf8");

            return res.json({
              ok: true,
              strategy: "learnedRule",
              patchedNodeId: top.nodeId,
              applied: {
                type: "classReplace",
                from: learned.from,
                to: learned.to,
                confidence: learned.confidence || 0,
              },
              topOffender: top,
              patchesFile: `/fixtures.out/${encodeURIComponent(slug)}/patches.json`,
            });
          }
        } catch (e) {
          console.warn("[autofix] learned-rule step failed:", String(e?.message || e));
        }
      }

      const existing = patches[top.nodeId] || {};
      const cycle = [
        { style: { transform: "translateX(1px)" } },
        { style: { transform: "translateX(-1px)" } },
        { style: { transform: "translateY(1px)" } },
        { style: { transform: "translateY(-1px)" } },
      ];

      let nextPatch = cycle[0];
      if (existing?.style?.transform) {
        const idx = cycle.findIndex((c) => c.style.transform === existing.style.transform);
        nextPatch = cycle[(idx + 1 + cycle.length) % cycle.length];
      }

      patches[top.nodeId] = {
        ...(patches[top.nodeId] || {}),
        ...nextPatch,
      };

      fs.writeFileSync(patchesPath, JSON.stringify(patches, null, 2), "utf8");

      return res.json({
        ok: true,
        strategy: "nudgeCycle",
        patchedNodeId: top.nodeId,
        applied: patches[top.nodeId],
        topOffender: top,
        patchesFile: `/fixtures.out/${encodeURIComponent(slug)}/patches.json`,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
