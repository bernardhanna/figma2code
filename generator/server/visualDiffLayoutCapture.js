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

    const layout = await page.evaluate(async () => {
      let rootDoc = document;
      let offsetX = 0;
      let offsetY = 0;

      const iframe = document.getElementById("vp_iframe");
      if (iframe) {
        await new Promise((resolve) => {
          const doc = iframe.contentDocument;
          if (doc && doc.readyState === "complete") return resolve();
          iframe.addEventListener("load", () => resolve(), { once: true });
          setTimeout(resolve, 1500);
        });
        const doc = iframe.contentDocument;
        if (doc) {
          rootDoc = doc;
          const r = iframe.getBoundingClientRect();
          offsetX = r.x;
          offsetY = r.y;
          try {
            if (doc.fonts?.ready) await doc.fonts.ready;
          } catch {}
        }
      }

      const els = Array.from(rootDoc.querySelectorAll("[data-node-id],[data-node]"));
      const getNodeId = (node) =>
        !node
          ? null
          : node.getAttribute("data-node-id") ||
            node.getAttribute("data-node") ||
            node.dataset?.nodeId ||
            null;
      return els.map((el) => {
        const nodeId =
          getNodeId(el);
        const parentNodeId = getNodeId(el.parentElement);
        const childCount = Array.from(el.children || []).filter((child) => Boolean(getNodeId(child))).length;

        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);

        return {
          nodeId,
          dataKey: el.getAttribute("data-key") || "",
          decorative: String(el.getAttribute("data-decorative") || "") === "1",
          tag: el.tagName.toLowerCase(),
          className: el.className || "",
          parentClassName: (el.parentElement && el.parentElement.className) || "",
          parentNodeId,
          childCount,
          bbox: { x: r.x + offsetX, y: r.y + offsetY, w: r.width, h: r.height },
          styles: {
            display: cs.display,
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
