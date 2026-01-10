// generator/server/visualDiffScreenshot.js

export async function stableElementScreenshot(page, url, selector, viewport, waitMs, minHeight) {
  await page.setViewportSize(viewport || { width: 1440, height: 900 });

  // Deterministic rendering
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after { transition: none !important; animation: none !important; }
      html { scroll-behavior: auto !important; }
    `,
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (waitMs) await page.waitForTimeout(waitMs);

  await page.waitForSelector(selector, { state: "attached", timeout: 30000 });

  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });

  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.all(
      imgs.map(async (img) => {
        try {
          if (!img.complete) {
            await new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            });
          }
          if (img.decode) await img.decode().catch(() => { });
        } catch { }
      })
    );
  });

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const el = await page.$(selector);

  if (!el) {
    const buffer = await page.screenshot({ fullPage: true, animations: "disabled" });
    return {
      buffer,
      meta: { mode: "fullPageFallback", reason: "selector_not_found", selector },
    };
  }

  const box = await el.boundingBox();
  const h = box?.height || 0;
  const w = box?.width || 0;

  if (!box || w <= 0 || h < (minHeight || 0)) {
    const buffer = await page.screenshot({ fullPage: true, animations: "disabled" });
    return {
      buffer,
      meta: {
        mode: "fullPageFallback",
        reason: "bounding_box_too_small",
        selector,
        box,
        minHeight: minHeight || 0,
      },
    };
  }

  const buffer = await el.screenshot({ animations: "disabled" });
  return {
    buffer,
    meta: { mode: "element", selector, box, minHeight: minHeight || 0 },
  };
}

export function absUrl(serverUrl, maybeRelative) {
  const s = String(maybeRelative || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return String(serverUrl).replace(/\/$/, "") + (s.startsWith("/") ? s : "/" + s);
}

export function cropToMin(PNG, a, b) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);

  const ac = new PNG({ width: w, height: h });
  const bc = new PNG({ width: w, height: h });

  PNG.bitblt(a, ac, 0, 0, w, h, 0, 0);
  PNG.bitblt(b, bc, 0, 0, w, h, 0, 0);

  return { w, h, ac, bc };
}
