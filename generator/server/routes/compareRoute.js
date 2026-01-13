// generator/server/routes/compareRoute.js
//
// /api/compare/:slug with optional multi-viewport output.
// Outputs per-viewport:
//  - render.mobile.png, diff.mobile.png, score.mobile.json
//  - render.tablet.png, diff.tablet.png, score.tablet.json
//  - render.desktop.png, diff.desktop.png, score.desktop.json
// Back-compat aliases (desktop):
//  - render.png, diff.png, score.json
//
// IMPORTANT:
// - Preview must support query params:
//    ?vpw=<number> to force iframe viewport width
//    ?ov=0 to force overlay OFF
// - Screenshot selector defaults to "#cmp_root"

import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { stableElementScreenshot, cropToMin } from "../../auto/elementDiff.js";

function viewportPresetsFromFrameWidth(frameW, modes) {
  const w = Math.max(1, Math.round(frameW || 1200));
  const preset = {
    mobile: { key: "mobile", width: Math.min(768, w) },
    tablet: { key: "tablet", width: Math.min(1024, w) },
    desktop: { key: "desktop", width: w },
  };
  return modes.map((m) => preset[m]).filter(Boolean);
}

function resolveFigmaForMode(outDir, legacyFigmaPath, mode) {
  const modePath = path.join(outDir, `figma.${mode}.png`);
  if (fs.existsSync(modePath)) return modePath;

  if (fs.existsSync(legacyFigmaPath)) return legacyFigmaPath;

  // Final fallback: try desktop if legacy missing
  const desktopPath = path.join(outDir, `figma.desktop.png`);
  if (fs.existsSync(desktopPath)) return desktopPath;

  return legacyFigmaPath;
}

function publicFigmaUrl(slug, mode, outDir, legacyExists) {
  const base = `/fixtures.out/${encodeURIComponent(slug)}`;
  const modeRel = `figma.${mode}.png`;
  const modePath = path.join(outDir, modeRel);
  if (fs.existsSync(modePath)) return `${base}/${modeRel}`;
  if (legacyExists) return `${base}/figma.png`;
  // Last resort: desktop
  const dPath = path.join(outDir, "figma.desktop.png");
  if (fs.existsSync(dPath)) return `${base}/figma.desktop.png`;
  return `${base}/figma.png`;
}

export function registerCompareRoute(app, ctx) {
  if (!app) throw new Error("registerCompareRoute: missing app");
  if (!ctx || typeof ctx.getFixturePaths !== "function") {
    throw new Error("registerCompareRoute: ctx.getFixturePaths required");
  }
  if (typeof ctx.getPreviewUrl !== "function") {
    throw new Error("registerCompareRoute: ctx.getPreviewUrl required");
  }

  app.post("/api/compare/:slug", async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

    const { outDir, figmaPath, renderPath, diffPath, scorePath } =
      ctx.getFixturePaths(slug);

    fs.mkdirSync(outDir, { recursive: true });

    const legacyFigmaExists = fs.existsSync(figmaPath);
    const desktopFigmaPath = path.join(outDir, "figma.desktop.png");

    // Required: accept either legacy figma.png or figma.desktop.png
    if (!legacyFigmaExists && !fs.existsSync(desktopFigmaPath)) {
      return res.status(404).json({
        ok: false,
        error: `Missing figma overlay for "${slug}". Expected ${figmaPath} OR ${desktopFigmaPath}`,
      });
    }

    const previewUrl = ctx.getPreviewUrl(slug);
    const figmaUrl = typeof ctx.getFigmaUrl === "function" ? ctx.getFigmaUrl(slug) : "";

    const selector = String(req.body?.screenshot?.selector || "#cmp_root");
    const waitMs = Number(req.body?.waitMs ?? 350);
    const minHeight = Number(req.body?.screenshot?.minHeight ?? 50);

    const threshold = typeof req.body?.threshold === "number" ? req.body.threshold : 0.1;
    const includeAA = req.body?.includeAA !== false;
    const passDiffRatio = typeof req.body?.passDiffRatio === "number" ? req.body.passDiffRatio : 0.03;

    const multi =
      req.body?.multi === true ||
      req.body?.viewports === "all" ||
      req.query?.viewports === "all";

    const stagedAst =
      typeof ctx.getStagedAst === "function" ? ctx.getStagedAst(slug) : null;

    // Frame width for preview sizing
    const frameW = Math.max(
      1,
      Math.round(stagedAst?.frame?.w || stagedAst?.tree?.w || 1200)
    );

    // Determine which modes are eligible based on available figma.<mode>.png
    // Your constraint: mobile + desktop only, tablet optional.
    const modes = [];
    if (fs.existsSync(path.join(outDir, "figma.mobile.png"))) modes.push("mobile");
    if (fs.existsSync(path.join(outDir, "figma.tablet.png"))) modes.push("tablet");
    // Always include desktop if ANY figma exists
    modes.push("desktop");

    const presets = multi ? viewportPresetsFromFrameWidth(frameW, modes) : null;

    async function runOne({ key, width }) {
      // Pick correct Figma for this mode
      const figmaForModePath = resolveFigmaForMode(outDir, figmaPath, key);
      const figmaPng = PNG.sync.read(fs.readFileSync(figmaForModePath));

      const viewport = {
        width,
        height: Math.max(figmaPng.height + 140, 900),
      };

      const url = `${previewUrl}?vpw=${encodeURIComponent(width)}&ov=0`;

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();

        const shot = await stableElementScreenshot(
          page,
          url,
          selector,
          viewport,
          waitMs,
          minHeight
        );

        const renderPng = PNG.sync.read(shot.buffer);

        const { w, h, ac: figmaCrop, bc: renderCrop } = cropToMin(
          PNG,
          figmaPng,
          renderPng
        );

        const diff = new PNG({ width: w, height: h });

        const diffPixels = pixelmatch(
          figmaCrop.data,
          renderCrop.data,
          diff.data,
          w,
          h,
          { threshold, includeAA }
        );

        const totalPixels = w * h;
        const diffRatio = totalPixels ? diffPixels / totalPixels : 1;

        const score = {
          slug,
          url: previewUrl,
          viewport,
          screenshot: shot.meta,
          figma: {
            path: figmaForModePath,
            url: figmaUrl,
            width: figmaPng.width,
            height: figmaPng.height,
            mode: key,
          },
          crop: { width: w, height: h },
          diffPixels,
          totalPixels,
          diffRatio,
          pass: diffRatio <= passDiffRatio,
          compare: { threshold, includeAA, passDiffRatio },
          at: new Date().toISOString(),
          mode: key,
        };

        return { shotBuffer: shot.buffer, diffPng: diff, score };
      } finally {
        await browser.close().catch(() => { });
      }
    }

    try {
      // ---------------- Single run (desktop back-compat) ----------------
      if (!multi) {
        const r = await runOne({ key: "desktop", width: frameW });

        fs.writeFileSync(renderPath, r.shotBuffer);
        fs.writeFileSync(diffPath, PNG.sync.write(r.diffPng));
        fs.writeFileSync(scorePath, JSON.stringify(r.score, null, 2), "utf8");

        return res.json({
          ok: true,
          score: r.score,
          files: {
            figma: publicFigmaUrl(slug, "desktop", outDir, legacyFigmaExists),
            render: `/fixtures.out/${slug}/render.png`,
            diff: `/fixtures.out/${slug}/diff.png`,
            score: `/fixtures.out/${slug}/score.json`,
          },
        });
      }

      // ---------------- Multi-viewport run ----------------
      const results = {};

      for (const p of presets) {
        const outRender = path.join(outDir, `render.${p.key}.png`);
        const outDiff = path.join(outDir, `diff.${p.key}.png`);
        const outScore = path.join(outDir, `score.${p.key}.json`);

        const r = await runOne(p);

        fs.writeFileSync(outRender, r.shotBuffer);
        fs.writeFileSync(outDiff, PNG.sync.write(r.diffPng));
        fs.writeFileSync(outScore, JSON.stringify(r.score, null, 2), "utf8");

        results[p.key] = {
          score: r.score,
          files: {
            figma: publicFigmaUrl(slug, p.key, outDir, legacyFigmaExists),
            render: `/fixtures.out/${slug}/render.${p.key}.png`,
            diff: `/fixtures.out/${slug}/diff.${p.key}.png`,
            score: `/fixtures.out/${slug}/score.${p.key}.json`,
          },
        };
      }

      // Back-compat alias => desktop
      fs.copyFileSync(path.join(outDir, "render.desktop.png"), renderPath);
      fs.copyFileSync(path.join(outDir, "diff.desktop.png"), diffPath);
      fs.copyFileSync(path.join(outDir, "score.desktop.json"), scorePath);

      const allPath = path.join(outDir, "score.all.json");
      fs.writeFileSync(
        allPath,
        JSON.stringify({ slug, at: new Date().toISOString(), results }, null, 2),
        "utf8"
      );

      return res.json({
        ok: true,
        slug,
        results,
        files: {
          all: `/fixtures.out/${slug}/score.all.json`,
          figma: publicFigmaUrl(slug, "desktop", outDir, legacyFigmaExists),
          render: `/fixtures.out/${slug}/render.png`,
          diff: `/fixtures.out/${slug}/diff.png`,
          score: `/fixtures.out/${slug}/score.json`,
        },
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e?.message ? String(e.message) : String(e),
      });
    }
  });
}
