// generator/server/routesUpload.js

import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR } from "./runtimePaths.js";

export function registerUploadRoutes(app) {
  // ---- Asset upload (used by plugin/UI for image fills etc.) ----
  app.post("/api/upload", (req, res) => {
    try {
      const body = req.body || {};

      // Backward compat mapping
      const dataUrlCompat =
        typeof body.dataUrl === "string"
          ? body.dataUrl
          : typeof body.data === "string"
            ? body.data
            : undefined;

      const filenameCompat =
        typeof body.filename === "string"
          ? body.filename
          : typeof body.slug === "string"
            ? body.slug
            : typeof body.name === "string"
              ? body.name
              : undefined;

      const filenameRaw = String(filenameCompat || "asset").trim();

      // Basic filename sanitation
      const safeName =
        filenameRaw.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "asset";

      let bytes;
      let ext = path.extname(safeName);

      // dataUrl path
      if (typeof dataUrlCompat === "string" && dataUrlCompat.startsWith("data:")) {
        const m = dataUrlCompat.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return res.status(400).json({ ok: false, error: "Invalid dataUrl" });

        const mime = m[1];
        const b64 = m[2];

        bytes = Buffer.from(b64, "base64");

        // Derive extension if missing
        if (!ext) {
          if (mime === "image/png") ext = ".png";
          else if (mime === "image/jpeg") ext = ".jpg";
          else if (mime === "image/webp") ext = ".webp";
          else if (mime === "image/svg+xml") ext = ".svg";
          else ext = ".bin";
        }
      }

      // raw base64 path
      if (!bytes && typeof body.bytesBase64 === "string") {
        bytes = Buffer.from(body.bytesBase64, "base64");

        if (!ext) {
          const mime = String(body.mime || "").toLowerCase();
          if (mime === "image/png") ext = ".png";
          else if (mime === "image/jpeg") ext = ".jpg";
          else if (mime === "image/webp") ext = ".webp";
          else if (mime === "image/svg+xml") ext = ".svg";
          else ext = ".bin";
        }
      }

      if (!bytes) return res.status(400).json({ ok: false, error: "Missing dataUrl or bytesBase64" });

      // Ensure unique-ish file name
      const stamp = Date.now().toString(36);
      const base = ext ? safeName.replace(ext, "") : safeName;
      const finalName = `${base}-${stamp}${ext || ""}`;

      const outPath = path.join(ASSETS_DIR, finalName);
      fs.writeFileSync(outPath, bytes);

      return res.json({ ok: true, url: `/assets/${finalName}`, path: outPath });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
