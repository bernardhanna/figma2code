// generator/server/routesConfig.js

import fs from "node:fs";
import { readConfig, setConfig } from "./configStore.js";

function listComponentTypes(rootDir) {
  const root = String(rootDir || "").trim();
  if (!root) return { items: [], error: "Missing componentsRoot" };
  if (!fs.existsSync(root)) return { items: [], error: `componentsRoot not found: ${root}` };

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const items = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return { items, error: "" };
}

export function registerConfigRoutes(app) {
  app.get("/api/config", (req, res) => {
    try {
      const cfg = readConfig();
      return res.json({ ok: true, config: cfg });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/components", (req, res) => {
    try {
      const cfg = readConfig();
      const { items, error } = listComponentTypes(cfg.componentsRoot);
      return res.json({ ok: !error, root: cfg.componentsRoot, items, error: error || undefined });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/config", (req, res) => {
    try {
      const themeRootRaw = String(req.body?.themeRoot || "").trim();
      const componentsRootRaw = String(req.body?.componentsRoot || "").trim();

      if (!themeRootRaw && !componentsRootRaw) {
        return res.status(400).json({ ok: false, error: "Missing themeRoot/componentsRoot" });
      }

      const next = {};
      if (themeRootRaw) next.themeRoot = themeRootRaw;
      if (componentsRootRaw) next.componentsRoot = componentsRootRaw;

      setConfig(next);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
