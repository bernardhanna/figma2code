import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { ASSETS_DIR } from "../server/runtimePaths.js";

function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nodeType(node) {
  return String(node?.type || "").trim().toLowerCase();
}

function mimeFromExt(filePath) {
  const ext = String(path.extname(filePath || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function extractImageHrefs(svgMarkup) {
  const hrefs = [];
  const re = /<image\b[^>]*\b(?:href|xlink:href)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(svgMarkup || "")))) {
    const href = String(m[1] || "").trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function parseImageLayers(svgMarkup) {
  const layers = [];
  const re = /<image\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(String(svgMarkup || "")))) {
    const attrs = String(m[1] || "");
    const href =
      (attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] || attrs.match(/\bxlink:href=["']([^"']+)["']/i)?.[1] || "").trim();
    const x = Number(attrs.match(/\bx=["']([^"']+)["']/i)?.[1]);
    const y = Number(attrs.match(/\by=["']([^"']+)["']/i)?.[1]);
    const w = Number(attrs.match(/\bwidth=["']([^"']+)["']/i)?.[1]);
    const h = Number(attrs.match(/\bheight=["']([^"']+)["']/i)?.[1]);
    layers.push({
      raw: m[0],
      href,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      w: Number.isFinite(w) ? w : 0,
      h: Number.isFinite(h) ? h : 0,
    });
  }
  return layers;
}

function maybeDropDominantBackgroundLayer(svgMarkup, node) {
  if (String(process.env.ICON_COMPOSE_DROP_BG_LAYER || "").trim() !== "1") {
    return svgMarkup;
  }
  const layers = parseImageLayers(svgMarkup);
  if (layers.length < 2) return svgMarkup;
  const nw = Number(node?.w || node?.bb?.w || 0);
  const nh = Number(node?.h || node?.bb?.h || 0);
  if (!(nw > 0) || !(nh > 0)) return svgMarkup;
  const nodeArea = nw * nh;
  if (!(nodeArea > 0)) return svgMarkup;

  const scored = layers
    .map((l, idx) => ({ idx, area: Math.max(0, l.w) * Math.max(0, l.h), layer: l }))
    .sort((a, b) => b.area - a.area);
  const top = scored[0];
  const second = scored[1];
  if (!top || !second) return svgMarkup;
  const topRatio = top.area / nodeArea;
  const dominance = second.area > 0 ? top.area / second.area : Number.POSITIVE_INFINITY;
  const hrefName = path.basename(String(top.layer.href || "")).toLowerCase();
  const bgNameHint = /\b(ellipse|circle|bg|background|shape)\b/.test(hrefName);
  if (topRatio < 0.45) return svgMarkup;
  if (dominance < 1.6 && !bgNameHint) return svgMarkup;

  return String(svgMarkup || "").replace(top.layer.raw, "");
}

function hasExternalAssetsOnly(svgMarkup) {
  const hrefs = extractImageHrefs(svgMarkup);
  if (!hrefs.length) return false;
  for (const href of hrefs) {
    if (!href.startsWith("/assets/")) return false;
  }
  return true;
}

function inlineAssetHrefs(svgMarkup) {
  let replaced = String(svgMarkup || "");
  const hrefs = extractImageHrefs(replaced);
  if (!hrefs.length) return { ok: false, reason: "no-images", markup: replaced };

  for (const href of hrefs) {
    if (!href.startsWith("/assets/")) return { ok: false, reason: "non-local-asset", markup: replaced };
    const assetFile = path.join(ASSETS_DIR, path.basename(href));
    if (!fs.existsSync(assetFile)) return { ok: false, reason: "missing-asset", markup: replaced };

    const bytes = fs.readFileSync(assetFile);
    const mime = mimeFromExt(assetFile);
    const dataUri = `data:${mime};base64,${bytes.toString("base64")}`;

    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const attrRe = new RegExp(`(href|xlink:href)=["']${escapedHref}["']`, "g");
    replaced = replaced.replace(attrRe, `href="${dataUri}"`);
  }

  return { ok: true, markup: replaced };
}

function composeIconNode(node) {
  if (!isObj(node)) return node;
  const svgMarkup = typeof node?.svg === "string" ? node.svg : "";
  if (!svgMarkup || nodeType(node) !== "svg") return node;
  if (!hasExternalAssetsOnly(svgMarkup)) return node;

  const filtered = maybeDropDominantBackgroundLayer(svgMarkup, node);
  const inlined = inlineAssetHrefs(filtered);
  if (!inlined.ok || !inlined.markup) return node;

  const hash = crypto.createHash("sha1").update(inlined.markup, "utf8").digest("hex").slice(0, 12);
  const fileName = `icon-composite-${hash}.svg`;
  const outPath = path.join(ASSETS_DIR, fileName);
  if (!fs.existsSync(outPath)) {
    fs.writeFileSync(outPath, inlined.markup, "utf8");
  }

  const next = { ...node };
  delete next.svg;
  next.img = {
    src: `/assets/${fileName}`,
    w: Number(node?.w) || Number(node?.bb?.w) || 16,
    h: Number(node?.h) || Number(node?.bb?.h) || 16,
  };
  next.__iconComposedImage = true;
  next.__lockedLayout = true;
  if (String(process.env.ICON_ISOLATION_DEBUG || "").trim() === "1") {
    console.warn(
      `[icon-compose] composed icon asset: id=${String(node?.id || "")} file=${fileName}`
    );
  }
  return next;
}

function walk(node) {
  if (!isObj(node)) return node;
  let out = { ...node };
  if (Array.isArray(node.children)) {
    out.children = node.children.map((child) => walk(child));
  }
  out = composeIconNode(out);
  return out;
}

export function rasterIconComposePass(ast) {
  if (!isObj(ast) || !isObj(ast.tree)) return ast;
  const out = { ...ast };
  out.tree = walk(ast.tree);
  return out;
}

