// generator/server/phase1Overlay.js

import fs from "node:fs";
import path from "node:path";
import { STAGING_DIR } from "./runtimePaths.js";

export function slugify(s) {
  return (
    String(s || "section")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|$)/g, "") || "section"
  );
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPhase1Overlay(ast) {
  const boxes = [];

  // Compute origin so overlay starts at (0,0)
  let minX = Infinity,
    minY = Infinity;

  (function scan(n) {
    const bb = n?.bb;
    if (bb && typeof bb.x === "number" && typeof bb.y === "number") {
      minX = Math.min(minX, bb.x);
      minY = Math.min(minY, bb.y);
    }
    for (const c of n?.children || []) scan(c);
  })(ast.tree);

  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;

  (function walk(n) {
    const bb = n?.bb;
    if (bb && typeof bb.x === "number") {
      const left = bb.x - minX;
      const top = bb.y - minY;
      boxes.push(`
<div class="box" style="left:${left}px;top:${top}px;width:${bb.w}px;height:${bb.h}px">
  <span>${escapeHtml(n.type)} · ${escapeHtml(n.name || "")} · ${escapeHtml((n.id || "").slice(-6))} · ${bb.w}×${bb.h}</span>
</div>`);
    }
    for (const c of n?.children || []) walk(c);
  })(ast.tree);

  const frameW = ast.frame?.w || 1200;
  const frameH = ast.frame?.h || 800;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Phase-1 Overlay · ${escapeHtml(ast.slug || "")}</title>
  <style>
    body{margin:0;background:#0b0e14;color:#e6edf3;font-family:ui-sans-serif,system-ui;}
    .wrap{position:relative;margin:24px;display:inline-block;}
    .frame{position:relative;width:${frameW}px;height:${frameH}px;background:rgba(255,255,255,0.04);outline:1px solid rgba(255,255,255,0.08);}
    .box{position:absolute;box-sizing:border-box;border:1px dashed rgba(0,255,255,.55);}
    .box span{position:absolute;left:0;top:-14px;font:10px/1.2 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#6ee7ff;white-space:nowrap;pointer-events:none;}
    .meta{max-width:1100px;margin:24px;}
    .meta pre{background:#111827;border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:10px;overflow:auto;}
  </style>
</head>
<body>
  <div class="meta">
    <h1 style="margin:0 0 8px 0;font-size:18px;">Phase-1 Raw Truth Overlay</h1>
    <div style="opacity:.8;margin-bottom:10px;">
      <strong>${escapeHtml(ast.meta?.figma?.frameName || ast.slug || "")}</strong>
      <span style="opacity:.7;">· schema ${escapeHtml(ast.meta?.schema || "")} v${escapeHtml(
    String(ast.meta?.version || "")
  )}</span>
    </div>
    <pre>${escapeHtml(
    JSON.stringify({ slug: ast.slug, frame: ast.frame, exportedAt: ast.meta?.exportedAt }, null, 2)
  )}</pre>
  </div>
  <div class="wrap">
    <div class="frame">
      ${boxes.join("\n")}
    </div>
  </div>
</body>
</html>`;
}

export function writePhase1Stage(slug, ast) {
  const dir = path.join(STAGING_DIR, "phase1", slug);
  fs.mkdirSync(dir, { recursive: true });

  const rawPath = path.join(dir, "phase1.raw.json");
  const overlayPath = path.join(dir, "phase1.overlay.html");

  fs.writeFileSync(rawPath, JSON.stringify(ast, null, 2), "utf8");
  fs.writeFileSync(overlayPath, renderPhase1Overlay(ast), "utf8");

  return { rawPath, overlayPath, overlayUrl: `/phase1/overlay/${slug}` };
}
