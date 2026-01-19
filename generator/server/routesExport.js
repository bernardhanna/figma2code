// generator/server/routesExport.js
import { exportComponent } from "../export/index.js";
import { getConfig } from "./configStore.js";

export function registerExportRoutes(app) {
  app.post("/export", async (req, res) => {
    try {
      const slug = String(req.body?.slug || "").trim();
      const type = String(req.body?.type || "").trim();
      const componentsRoot = String(req.body?.componentsRoot || "").trim();

      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
      if (!type) return res.status(400).json({ ok: false, error: "Missing type" });

      const cfg = getConfig();
      const resolvedComponentsRoot = componentsRoot || cfg.componentsRoot;

      const result = await exportComponent({
        slug,
        type,
        componentsRoot: resolvedComponentsRoot || undefined,
      });

      return res.json(result);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

