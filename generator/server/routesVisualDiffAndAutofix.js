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

function baseSlugFrom(slug) {
  const s = String(slug || "").trim();
  if (!s) return "";
  return s.replace(/(_|-|@)(desktop|tablet|mobile)$/i, "").trim();
}

function hasAnyFigmaInDir(dir) {
  if (!fs.existsSync(dir)) return false;
  const candidates = [
    "figma.png",
    "figma.desktop.png",
    "figma.mobile.png",
    "figma.tablet.png",
  ];
  return candidates.some((f) => fs.existsSync(path.join(dir, f)));
}

function resolveOutDirForCompare(slugRaw) {
  const base = baseSlugFrom(slugRaw);
  const dirRaw = path.join(VDIFF_DIR, slugRaw);
  const dirBase = base ? path.join(VDIFF_DIR, base) : dirRaw;

  // Prefer base dir if it contains the new overlay convention or any figma assets
  if (base && hasAnyFigmaInDir(dirBase)) return { outDir: dirBase, publicSlug: base };
  return { outDir: dirRaw, publicSlug: slugRaw };
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

function resolveLocalFigmaPath(outDir, mode) {
  const m = String(mode || "").trim().toLowerCase();
  const modePath = path.join(outDir, `figma.${m}.png`);
  if (fs.existsSync(modePath)) return modePath;

  const legacy = path.join(outDir, "figma.png");
  if (fs.existsSync(legacy)) return legacy;

  const desktop = path.join(outDir, "figma.desktop.png");
  if (fs.existsSync(desktop)) return desktop;

  const mobile = path.join(outDir, "figma.mobile.png");
  if (fs.existsSync(mobile)) return mobile;

  return "";
}

function publicFigmaUrl(publicSlug, mode) {
  const base = `/fixtures.out/${encodeURIComponent(publicSlug)}`;
  const m = String(mode || "").trim().toLowerCase();
  return `${base}/figma.${m}.png`;
}

export function registerVisualDiffAndAutofixRoutes(app, { port }) {
  app.post("/api/layout/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const { chromium } = await loadCompareDeps();

      const { outDir } = resolveOutDirForCompare(slug);
      ensureDir(outDir);

      const viewport =
        req.body?.viewport && typeof req.body.viewport === "object" ? req.body.viewport : null;
      const waitMs = typeof req.body?.waitMs === "number" ? req.body.waitMs : 200;

      const layout = await captureLayoutJson({ chromium, slug, port, outDir, viewport, waitMs });
      return res.json({ ok: true, count: layout.length, path: `//${slug}/layout.json` });
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

      const { PNG, pixelmatch, chromium } = await loadCompareDeps();

      const serverUrl = `http://127.0.0.1:${port}`;

      // selector/minHeight/waitMs (same as before)
      const shotCfg =
        req.body?.screenshot && typeof req.body.screenshot === "object" ? req.body.screenshot : null;
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

      const threshold = typeof req.body?.threshold === "number" ? req.body.threshold : 0.1;
      const includeAA = req.body?.includeAA !== false;
      const passDiffRatio = typeof req.body?.passDiffRatio === "number" ? req.body.passDiffRatio : 0.03;

      const multi = req.body?.multi === true || req.body?.viewports === "all";
      const tabletMax =
        typeof req.body?.tabletMax === "number" && req.body.tabletMax > 0 ? req.body.tabletMax : 1024;

      // IMPORTANT: Use base/group dir for overlays if present
      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
      ensureDir(outDir);
      ensurePatchesFile(outDir);

      const elementDiffPath = path.join(outDir, "element-diff.json");

      const renderPath = path.join(outDir, "render.png");
      const diffPath = path.join(outDir, "diff.png");
      const scorePath = path.join(outDir, "score.json");

      // Legacy overlaySrc (optional now)
      const overlaySrc = String(staged?.ast?.meta?.overlay?.src || "").trim();

      // If we have no local figma assets AND no overlay src, we cannot compare.
      const anyLocalFigma = hasAnyFigmaInDir(outDir);
      if (!anyLocalFigma && !overlaySrc) {
        return res.status(400).json({
          ok: false,
          error:
            `Missing overlay for "${slug}". Provide ast.meta.overlay.src OR write overlays to ` +
            `"${outDir}/figma.desktop.png" (and optionally figma.mobile.png).`,
        });
      }

      // If overlaySrc exists and we don't already have a legacy figma.png, materialize it to figma.png for caching.
      // If overlaySrc exists, materialize it into the new convention:
      // - figma.desktop.png (primary)
      // - figma.png (legacy/back-compat)
      async function ensureDesktopOverlayDownloadedIfNeeded() {
        const desktopPath = path.join(outDir, "figma.desktop.png");
        const legacyPath = path.join(outDir, "figma.png");

        // If either exists, we are good. Prefer desktop as the canonical file.
        if (fs.existsSync(desktopPath)) return desktopPath;
        if (fs.existsSync(legacyPath)) return legacyPath;

        if (!overlaySrc) return "";

        const figmaUrl = absUrl(serverUrl, overlaySrc);
        const figmaResp = await fetch(figmaUrl);
        if (!figmaResp.ok) {
          throw new Error(`Failed to fetch overlay image: ${figmaUrl} (status ${figmaResp.status})`);
        }

        const buf = Buffer.from(await figmaResp.arrayBuffer());

        // Write both: primary + legacy
        fs.writeFileSync(desktopPath, buf);
        fs.writeFileSync(legacyPath, buf);

        return desktopPath;
      }


      async function loadFigmaPngForMode(mode) {
        const local = resolveLocalFigmaPath(outDir, mode);
        if (local) {
          return {
            path: local,
            src: publicFigmaUrl(publicSlug, mode),
            png: PNG.sync.read(fs.readFileSync(local)),
          };
        }

        // fallback: download legacy overlay if we have overlaySrc
        // fallback: download desktop overlay if we have overlaySrc
        const downloaded = await ensureDesktopOverlayDownloadedIfNeeded();
        if (!downloaded || !fs.existsSync(downloaded)) {
          throw new Error(`No figma overlay file found for mode "${mode}" in ${outDir}`);
        }

        return {
          path: downloaded,
          // Once downloaded, always prefer the public fixtures path (stable for UI links)
          src: publicFigmaUrl(publicSlug, "desktop"),
          png: PNG.sync.read(fs.readFileSync(downloaded)),
        };

      }

      // Single run: choose desktop mode by default
      async function runCompareOne({ key, viewport }) {
        const mode = String(key || "desktop").toLowerCase();
        const figma = await loadFigmaPngForMode(mode);

        // IMPORTANT: force overlay OFF and force viewport width via vpw
        const previewUrl =
          `${serverUrl}/preview/${encodeURIComponent(slug)}` +
          `?ov=0&vpw=${encodeURIComponent(viewport.width)}`;

        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();

          const shot = await stableElementScreenshot(
            page,
            previewUrl,
            selector,
            viewport,
            waitMs,
            minHeight
          );

          const rPath = key ? path.join(outDir, `render.${key}.png`) : renderPath;
          const dPath = key ? path.join(outDir, `diff.${key}.png`) : diffPath;
          const sPath = key ? path.join(outDir, `score.${key}.json`) : scorePath;

          fs.writeFileSync(rPath, shot.buffer);

          const renderPng = PNG.sync.read(fs.readFileSync(rPath));
          const { w, h, ac: figmaCrop, bc: renderCrop } = cropToMin(PNG, figma.png, renderPng);
          const diff = new PNG({ width: w, height: h });

          const diffPixels = pixelmatch(figmaCrop.data, renderCrop.data, diff.data, w, h, {
            threshold,
            includeAA,
          });

          fs.writeFileSync(dPath, PNG.sync.write(diff));

          const totalPixels = w * h;
          const diffRatio = totalPixels ? diffPixels / totalPixels : 1;

          const score = {
            slug: publicSlug, // store public slug (group-aware)
            url: previewUrl,
            viewport,
            screenshot: shot.meta,
            figma: { path: figma.path, width: figma.png.width, height: figma.png.height, src: figma.src, mode },
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
              figma: figma.src,
              render: `/fixtures.out/${encodeURIComponent(publicSlug)}/${key ? `render.${key}.png` : "render.png"}`,
              diff: `/fixtures.out/${encodeURIComponent(publicSlug)}/${key ? `diff.${key}.png` : "diff.png"}`,
              score: `/fixtures.out/${encodeURIComponent(publicSlug)}/${key ? `score.${key}.json` : "score.json"}`,
            },
          };
        } finally {
          await browser.close();
        }
      }

      // --- Run ---
      if (!multi) {
        const figmaDesktop = await loadFigmaPngForMode("desktop");

        const viewport =
          req.body?.viewport && typeof req.body.viewport === "object" && Number(req.body.viewport.width) > 0
            ? req.body.viewport
            : {
                width: figmaDesktop.png.width,
                height: Math.max(figmaDesktop.png.height + 140, 900),
              };

        const result = await runCompareOne({ key: null, viewport });

        try {
          const { chromium } = await loadCompareDeps();
          const layout = await captureLayoutJson({
            chromium,
            slug,
            port,
            outDir,
            viewport,
            waitMs: 50,
          });
          computeElementDiff(diffPath, layout, elementDiffPath);
        } catch (e) {
          console.warn("[autofix] element-diff computation failed:", String(e?.message || e));
        }

        return res.json({
          ok: true,
          score: result.score,
          artifacts: {
            ...result.artifacts,
            layout: `/fixtures.out/${encodeURIComponent(publicSlug)}/layout.json`,
            elementDiff: `/fixtures.out/${encodeURIComponent(publicSlug)}/element-diff.json`,
            patches: `/fixtures.out/${encodeURIComponent(publicSlug)}/patches.json`,
          },
        });
      }

      // multi
      const figmaDesktop = await loadFigmaPngForMode("desktop");
      const presets = viewportPresets(figmaDesktop.png.width, figmaDesktop.png.height, tabletMax);
      const results = {};

      for (const p of presets) {
        results[p.key] = await runCompareOne({ key: p.key, viewport: p.viewport });
      }

      // Back-compat alias => desktop
      if (fs.existsSync(path.join(outDir, "render.desktop.png"))) fs.copyFileSync(path.join(outDir, "render.desktop.png"), renderPath);
      if (fs.existsSync(path.join(outDir, "diff.desktop.png"))) fs.copyFileSync(path.join(outDir, "diff.desktop.png"), diffPath);
      if (fs.existsSync(path.join(outDir, "score.desktop.json"))) fs.copyFileSync(path.join(outDir, "score.desktop.json"), scorePath);

      fs.writeFileSync(
        path.join(outDir, "score.all.json"),
        JSON.stringify({ slug: publicSlug, at: new Date().toISOString(), results }, null, 2),
        "utf8"
      );

      return res.json({
        ok: true,
        slug: publicSlug,
        results,
        artifacts: {
          all: `/fixtures.out/${encodeURIComponent(publicSlug)}/score.all.json`,
          figma: publicFigmaUrl(publicSlug, "desktop"),
          render: `/fixtures.out/${encodeURIComponent(publicSlug)}/render.png`,
          diff: `/fixtures.out/${encodeURIComponent(publicSlug)}/diff.png`,
          score: `/fixtures.out/${encodeURIComponent(publicSlug)}/score.json`,
          patches: `/fixtures.out/${encodeURIComponent(publicSlug)}/patches.json`,
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // AutoFix endpoint unchanged from your version…
  app.post("/api/autofix/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
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
              patchesFile: `/fixtures.out/${encodeURIComponent(publicSlug)}/patches.json`,
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
