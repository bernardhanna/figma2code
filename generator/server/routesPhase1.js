// generator/server/routesPhase1.js

import fs from "node:fs";
import path from "node:path";

import { STAGING_DIR } from "./runtimePaths.js";
import { slugify, writePhase1Stage } from "./phase1Overlay.js";
import { parseGroupVariant } from "./variantNaming.js";

export function registerPhase1Routes(app) {
  app.post("/api/phase1/export", (req, res) => {
    try {
      const incoming = req.body || {};
      if (!incoming.tree) {
        return res.status(400).json({ ok: false, error: "Missing tree in Phase-1 payload" });
      }

      const frameName = incoming.slug || incoming.meta?.figma?.frameName || incoming.meta?.frameName || "section";
      const parsed = parseGroupVariant(frameName);

      const groupOrSlug = parsed.isVariant ? parsed.groupKey : frameName;
      const slug = slugify(groupOrSlug);

      const ast = {
        meta: incoming.meta || {
          schema: "raw-figma-ast",
          version: 1,
          exportedAt: new Date().toISOString(),
        },
        slug,
        type: incoming.type || "flexi_block",
        frame: incoming.frame || null,
        tree: incoming.tree,
        slots: incoming.slots || null,
        semantics: incoming.semantics || incoming.semanticsMap || undefined,
      };

      const out = writePhase1Stage(slug, ast);

      return res.json({
        ok: true,
        slug,
        overlayUrl: out.overlayUrl,
        paths: { raw: out.rawPath, overlay: out.overlayPath },
        variant: parsed.isVariant ? parsed.variant : null,
        groupKey: parsed.isVariant ? parsed.groupKey : null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/phase1/overlay/:slug", (req, res) => {
    const file = path.join(STAGING_DIR, "phase1", req.params.slug, "phase1.overlay.html");
    if (!fs.existsSync(file)) return res.status(404).send("Not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(fs.readFileSync(file, "utf8"));
  });
}
