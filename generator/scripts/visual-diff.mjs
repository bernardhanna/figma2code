// generator/scripts/visual-diff.mjs
// Playwright screenshot each /preview/<slug>, compare to fixtures/<slug>/figma.png.
// Outputs: generator/fixtures.out/<slug>/{render.png,diff.png,score.json}

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";

const ROOT = path.resolve(process.cwd()); // run from generator/
const FIXTURES_DIR = path.join(ROOT, "fixtures");
const OUT_DIR = path.join(ROOT, "fixtures.out");
const MANIFEST_PATH = path.join(FIXTURES_DIR, "index.json");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {
      serverUrl: "http://127.0.0.1:5173",
      default: {
        viewport: { width: 1440, height: 900 },
        waitMs: 350,
        screenshot: { mode: "element", selector: "#ov_root", fullPage: false },
        compare: { threshold: 0.1, includeAA: true, passDiffRatio: 0.02 },
      },
      fixtures: {},
    };
  }

  const m = readJson(MANIFEST_PATH);

  return {
    serverUrl: m.serverUrl || "http://127.0.0.1:5173",
    default: m.default || {},
    fixtures: m.fixtures || {},
  };
}

function deepMerge(base, override) {
  if (!override) return base;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function listFixtureSlugs() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function loadPng(file) {
  const buf = fs.readFileSync(file);
  return PNG.sync.read(buf);
}

function savePng(file, png) {
  const buf = PNG.sync.write(png);
  fs.writeFileSync(file, buf);
}

function cropToMin(a, b) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);

  const ac = new PNG({ width: w, height: h });
  const bc = new PNG({ width: w, height: h });

  PNG.bitblt(a, ac, 0, 0, w, h, 0, 0);
  PNG.bitblt(b, bc, 0, 0, w, h, 0, 0);

  return { w, h, ac, bc };
}

async function screenshotFixture(page, url, shotCfg, waitMs, outPath) {
  const mode = shotCfg?.mode || "element";

  // Deterministic rendering: reduce motion + kill transitions/animations
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after { transition: none !important; animation: none !important; }
      html { scroll-behavior: auto !important; }
    `,
  });

  // Avoid relying on networkidle for Tailwind CDN + any extra requests
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // If you want an extra safety delay, keep it, but it should be small.
  if (waitMs) await page.waitForTimeout(waitMs);

  if (mode === "fullPage") {
    await page.screenshot({
      path: outPath,
      fullPage: true,
      animations: "disabled",
      scale: "device",
      omitBackground: false,
    });
    return { mode: "fullPage" };
  }

  // element (default)
  const selector = shotCfg?.selector || "#cmp_root";

  // Wait for the element to exist and be visible
  await page.waitForSelector(selector, { state: "visible", timeout: 30000 });

  const el = await page.$(selector);
  if (!el) {
    await page.screenshot({
      path: outPath,
      fullPage: true,
      animations: "disabled",
      scale: "device",
      omitBackground: false,
    });
    return { mode: "fullPageFallback", selectorMissing: selector };
  }

  // Wait for fonts (prevents subtle text shifts)
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });

  // Wait for images inside the target root to be loaded+decoded
  await page.evaluate(async (sel) => {
    const root = document.querySelector(sel);
    if (!root) return;

    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        try {
          if (!img.complete) {
            await new Promise((res) => {
              img.addEventListener("load", res, { once: true });
              img.addEventListener("error", res, { once: true });
            });
          }
          if (img.decode) await img.decode().catch(() => { });
        } catch { }
      })
    );
  }, selector);

  // Give layout a couple frames to settle
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // Optional but highly recommended: ensure the element is not “collapsed”
  // Adjust minHeight if your cmp_root can legitimately be shorter.
  const minHeight = typeof shotCfg?.minHeight === "number" ? shotCfg.minHeight : 200;
  await page.waitForFunction(
    ({ sel, minH }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.height >= minH && r.width > 0;
    },
    { timeout: 30000 },
    { sel: selector, minH: minHeight }
  );

  // Finally screenshot the element
  await el.screenshot({
    path: outPath,
    animations: "disabled",
    scale: "device",
    omitBackground: false,
  });

  return { mode: "element", selector, minHeight };
}


async function runOne(page, serverUrl, manifest, slug) {
  const fixtureDir = path.join(FIXTURES_DIR, slug);
  const figmaPath = path.join(fixtureDir, "figma.png");
  const outDir = path.join(OUT_DIR, slug);
  ensureDir(outDir);

  if (!fs.existsSync(figmaPath)) {
    console.log(`- skip ${slug}: missing figma.png`);
    return;
  }

  // Compose config = defaults + per-fixture overrides
  const cfg = deepMerge(manifest.default || {}, manifest.fixtures?.[slug] || {});
  const viewport = cfg.viewport || { width: 1440, height: 900 };
  const waitMs = typeof cfg.waitMs === "number" ? cfg.waitMs : 350;
  const shotCfg = cfg.screenshot || { mode: "element", selector: "#ov_root" };

  const compareCfg = cfg.compare || {};
  const threshold = typeof compareCfg.threshold === "number" ? compareCfg.threshold : 0.1;
  const includeAA = compareCfg.includeAA !== false;
  const passDiffRatio =
    typeof compareCfg.passDiffRatio === "number" ? compareCfg.passDiffRatio : 0.02;

  await page.setViewportSize(viewport);

  const url = `${serverUrl}/preview/${encodeURIComponent(slug)}`;
  const renderPath = path.join(outDir, "render.png");

  const shotMeta = await screenshotFixture(page, url, shotCfg, waitMs, renderPath);

  const figma = loadPng(figmaPath);
  const render = loadPng(renderPath);

  const { w, h, ac: figmaCrop, bc: renderCrop } = cropToMin(figma, render);

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

  const diffPath = path.join(outDir, "diff.png");
  const scorePath = path.join(outDir, "score.json");

  savePng(diffPath, diff);

  const score = {
    slug,
    url,
    viewport,
    screenshot: shotMeta,
    figma: { path: figmaPath, width: figma.width, height: figma.height },
    render: { path: renderPath, width: render.width, height: render.height },
    compared: { width: w, height: h },
    compare: { threshold, includeAA, passDiffRatio },
    diffPixels,
    totalPixels,
    diffRatio,
    pass: diffRatio <= passDiffRatio,
    at: new Date().toISOString(),
  };

  fs.writeFileSync(scorePath, JSON.stringify(score, null, 2), "utf8");

  console.log(`✓ ${slug}: diffRatio ${(diffRatio * 100).toFixed(2)}% ${score.pass ? "(PASS)" : "(FAIL)"}`);
}

async function main() {
  const manifest = readManifest();
  const serverUrl = process.env.GEN_URL || manifest.serverUrl || "http://127.0.0.1:5173";

  const slugs = listFixtureSlugs().filter((slug) => {
    // requires ast.json + figma.png
    return (
      fs.existsSync(path.join(FIXTURES_DIR, slug, "ast.json")) &&
      fs.existsSync(path.join(FIXTURES_DIR, slug, "figma.png"))
    );
  });

  if (!slugs.length) {
    console.error(`No fixtures found. Expect fixtures/<slug>/{ast.json,figma.png}`);
    process.exit(1);
  }

  ensureDir(OUT_DIR);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    for (const slug of slugs) {
      await runOne(page, serverUrl, manifest, slug);
    }
  } finally {
    await browser.close();
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
