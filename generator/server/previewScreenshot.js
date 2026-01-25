// generator/server/previewScreenshot.js
import fs from "node:fs";
import path from "node:path";

import { PREVIEW_SCREEN_DIR } from "./runtimePaths.js";
import { loadCompareDeps } from "./visualDiffDeps.js";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeSlugForFile(slug) {
  return String(slug || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "preview";
}

async function waitForIframeContent(page) {
  try {
    await page.waitForSelector("#vp_iframe", { state: "attached", timeout: 20000 });
  } catch {
    return;
  }

  await page.evaluate(async () => {
    const iframe = document.getElementById("vp_iframe");
    if (!iframe) return;

    await new Promise((resolve) => {
      const doc = iframe.contentDocument;
      if (doc && doc.readyState === "complete") return resolve();
      iframe.addEventListener("load", () => resolve(), { once: true });
    });

    const doc = iframe.contentDocument;
    if (!doc) return;

    try {
      if (doc.fonts?.ready) await doc.fonts.ready;
    } catch {}

    const imgs = Array.from(doc.images || []);
    await Promise.all(
      imgs.map(async (img) => {
        try {
          if (!img.complete) {
            await new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            });
          }
          if (img.decode) await img.decode().catch(() => {});
        } catch {}
      })
    );

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (
        doc.querySelector("style#tailwindcss") ||
        doc.querySelector("style[data-tw]") ||
        doc.querySelector("style[data-tailwind]")
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  try {
    await page.waitForFunction(
      () => window.__TAILWIND_IFRAME_READY__ === true || window.__TAILWIND_READY__ === true,
      { timeout: 3000 }
    );
  } catch {}
}

export async function capturePreviewScreenshot({
  slug,
  port,
  viewport,
  selector = "#cmp_root",
  minHeight = 0,
  waitMs = 200,
  label = "",
}) {
  if (!slug) throw new Error("capturePreviewScreenshot: missing slug");
  if (!port) throw new Error("capturePreviewScreenshot: missing port");

  ensureDir(PREVIEW_SCREEN_DIR);

  const safeSlug = safeSlugForFile(slug);
  const safeLabel = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const stamp = Date.now();
  const fileName = `${safeSlug}-${safeLabel || "preview"}-${stamp}.png`;
  const outPath = path.join(PREVIEW_SCREEN_DIR, fileName);
  const url = `http://127.0.0.1:${port}/preview/${encodeURIComponent(slug)}?ov=0` +
    (viewport?.width ? `&vpw=${encodeURIComponent(viewport.width)}` : "");

  const { chromium } = await loadCompareDeps();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    if (viewport?.width && viewport?.height) {
      await page.setViewportSize(viewport);
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (waitMs) await page.waitForTimeout(waitMs);

    try {
      if (page?.evaluate) {
        await page.evaluate(async () => {
          if (document.fonts?.ready) await document.fonts.ready;
        });
      }
    } catch {}

    if (viewport?.width) {
      try {
        const expected = `${Math.round(viewport.width)}px`;
        await page.waitForFunction(
          (label) => {
            const el = document.getElementById("vp_readout");
            if (!el) return true;
            return String(el.textContent || "").includes(label);
          },
          expected,
          { timeout: 2000 }
        );
      } catch {}
    }

    await waitForIframeContent(page);

    const el = await page.$(selector);
    let buffer;
    let meta;

    if (!el) {
      buffer = await page.screenshot({ fullPage: true, animations: "disabled" });
      meta = { mode: "fullPageFallback", reason: "selector_not_found", selector };
    } else {
      const box = await el.boundingBox();
      const h = box?.height || 0;
      const w = box?.width || 0;
      if (!box || w <= 0 || h < minHeight) {
        buffer = await page.screenshot({ fullPage: true, animations: "disabled" });
        meta = {
          mode: "fullPageFallback",
          reason: "bounding_box_too_small",
          selector,
          box,
          minHeight,
        };
      } else {
        buffer = await el.screenshot({ animations: "disabled" });
        meta = { mode: "element", selector, box, minHeight };
      }
    }

    fs.writeFileSync(outPath, buffer);

    return {
      ok: true,
      path: outPath,
      url: `/preview-screens/${encodeURIComponent(fileName)}`,
      meta,
    };
  } finally {
    await browser.close();
  }
}

export async function capturePreviewScreenshots({
  slug,
  port,
  viewports,
  selector = "#cmp_root",
  minHeight = 0,
  waitMs = 200,
}) {
  const out = {};
  const items = Array.isArray(viewports) ? viewports : [];

  for (const v of items) {
    const key = String(v?.key || "").trim();
    if (!key) continue;
    const result = await capturePreviewScreenshot({
      slug,
      port,
      viewport: v.viewport,
      selector,
      minHeight,
      waitMs,
      label: key,
    });
    out[key] = result?.url || null;
  }

  return out;
}
