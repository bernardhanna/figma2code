// generator/server/routesConfig.js

import { setConfig } from "./configStore.js";

export function registerConfigRoutes(app) {
  app.post("/api/config", (req, res) => {
    try {
      const themeRoot = (req.body?.themeRoot || "").trim();
      if (!themeRoot) return res.status(400).json({ ok: false, error: "Missing themeRoot" });

      setConfig({ themeRoot });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
