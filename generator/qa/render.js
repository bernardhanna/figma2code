// generator/qa/render.js — Render preview at breakpoints and capture screenshots

import fs from "node:fs";
import path from "node:path";
import { loadCompareDeps } from "../server/visualDiffDeps.js";
import { stableElementScreenshot } from "../server/visualDiffScreenshot.js";
import { BREAKPOINTS, SCREENSHOT_SELECTOR, SCREENSHOT_MIN_HEIGHT, SCREENSHOT_WAIT_MS } from "./constants.js";

/**
 * Render preview at each breakpoint and save screenshots to outDir.
 * @param {{ slug: string, port: number, outDir: string, serverUrl: string }} options
 * @returns {{ desktop: string, tablet: string, mobile: string } | { error: string }}
 */
export async function renderAtBreakpoints({ slug, port, outDir, serverUrl }) {
  const safeSlug = String(slug || "").trim();
  if (!safeSlug) return { error: "Missing slug" };

  fs.mkdirSync(outDir, { recursive: true });

  let chromium;
  try {
    const deps = await loadCompareDeps();
    chromium = deps.chromium;
  } catch (e) {
    return { error: String(e?.message || e) };
  }

  const results = {};
  const baseUrl = String(serverUrl || "").replace(/\/+$/, "") || `http://127.0.0.1:${port || 5173}`;
  const previewUrl = `${baseUrl}/preview/${encodeURIComponent(safeSlug)}?ov=0`;

  const browser = await chromium.launch();
  try {
    for (const [key, viewport] of Object.entries(BREAKPOINTS)) {
      const vpw = viewport.width;
      const url = `${previewUrl}&vpw=${encodeURIComponent(vpw)}`;
      const page = await browser.newPage();
      try {
        const shot = await stableElementScreenshot(
          page,
          url,
          SCREENSHOT_SELECTOR,
          viewport,
          SCREENSHOT_WAIT_MS,
          SCREENSHOT_MIN_HEIGHT
        );
        const filename = `${key}.png`;
        const filepath = path.join(outDir, filename);
        fs.writeFileSync(filepath, shot.buffer);
        results[key] = filepath;
      } finally {
        await page.close();
      }
    }
    return results;
  } finally {
    await browser.close();
  }
}
