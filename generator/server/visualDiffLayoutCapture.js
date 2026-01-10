// generator/server/visualDiffLayoutCapture.js

import fs from "node:fs";
import path from "node:path";

export async function captureLayoutJson({ chromium, slug, port, outDir, viewport, waitMs }) {
  const serverUrl = `http://127.0.0.1:${port}`;
  const previewUrl = `${serverUrl}/preview/${encodeURIComponent(slug)}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setViewportSize(viewport || { width: 1440, height: 900 });
    await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
    if (waitMs) await page.waitForTimeout(waitMs);

    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });

    const layout = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("[data-node-id],[data-node]"));

      return els.map((el) => {
        const nodeId =
          el.getAttribute("data-node-id") ||
          el.getAttribute("data-node") ||
          el.dataset.nodeId ||
          null;

        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);

        return {
          nodeId,
          tag: el.tagName.toLowerCase(),
          className: el.className || "",
          bbox: { x: r.x, y: r.y, w: r.width, h: r.height },
          styles: {
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            textAlign: cs.textAlign,
          },
          text: (el.innerText || "").slice(0, 200),
        };
      });
    });

    const outPath = path.join(outDir, "layout.json");
    fs.writeFileSync(outPath, JSON.stringify(layout, null, 2), "utf8");
    return layout;
  } finally {
    await browser.close();
  }
}
