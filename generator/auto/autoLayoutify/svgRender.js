// generator/auto/autoLayoutify/svgRender.js
// ------------------------------------------------------------
// Minimal inline SVG renderer for common AST shapes.
// Supports:
// - node.svg.markup | node.svg.html  (serialized svg)
// - node.svg.paths[] / node.vector.paths[] (path d strings)
// - node.svg.d / node.vector.d (single path d string)
// ------------------------------------------------------------

import { cls, rem } from "./precision.js";
import { escAttr } from "./escape.js";
import { visibleStroke } from "./stroke.js";

const MAX_INLINE_DATA = Number(process.env.MAX_INLINE_DATA || 200000);

function attrsFromMap(attrs) {
  if (!attrs || typeof attrs !== "object") return "";
  return Object.entries(attrs)
    .map(([k, v]) => {
      const key = String(k || "").trim();
      if (!key) return "";
      if (v === false || v === null || typeof v === "undefined") return "";
      if (v === true) return ` ${escAttr(key)}`;
      return ` ${escAttr(key)}="${escAttr(String(v))}"`;
    })
    .filter(Boolean)
    .join("");
}

function svgBaseAttrs(node) {
  const dn = node?.id ? ` data-node="${escAttr(node.id)}"` : "";
  const custom = attrsFromMap(node?.attrs || node?.dataAttrs || null);
  return dn + custom;
}

function svgAttrString(node, classes, opts = {}) {
  const includeClass = opts.includeClass !== false;
  const includeAria = opts.includeAria === true;
  let style = typeof opts.style === "string" && opts.style.trim() ? opts.style.trim() : "";

  // Merge in state-based colors from __states if available
  const stateColors = [];
  if (node?.__states) {
    if (node.__states.hover) {
      const hoverColor = colorFromNode(node, "hover");
      if (hoverColor) stateColors.push(`--hover-color:${hoverColor}`);
    }
    if (node.__states.active) {
      const activeColor = colorFromNode(node, "active");
      if (activeColor) stateColors.push(`--active-color:${activeColor}`);
    }
    if (node.__states.focus) {
      const focusColor = colorFromNode(node, "focus");
      if (focusColor) stateColors.push(`--focus-color:${focusColor}`);
    }
  }
  if (stateColors.length) {
    style = style ? `${style};${stateColors.join(";")}` : stateColors.join(";");
  }
  const base = svgBaseAttrs(node);
  const classAttr = includeClass && classes ? ` class="${escAttr(classes)}"` : "";
  const styleAttr = style ? ` style="${escAttr(style)}"` : "";
  const aria = includeAria ? ` aria-hidden="true"` : "";
  return `${base}${classAttr}${styleAttr}${aria}`;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rgba01ToCss(rgba) {
  if (!rgba || typeof rgba !== "object") return "";
  const r = Math.round(clamp01(rgba.r) * 255);
  const g = Math.round(clamp01(rgba.g) * 255);
  const b = Math.round(clamp01(rgba.b) * 255);
  const a = typeof rgba.a === "number" ? clamp01(rgba.a) : 1;
  if (a >= 0.999) {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return `rgba(${r},${g},${b},${a})`;
}

function firstSolidFill(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : Array.isArray(node?.fill) ? node.fill : [];
  for (const f of fills) {
    const kind = String(f?.kind || f?.type || f?.fillType || "").toLowerCase();
    if (kind === "solid" || kind === "color") {
      return f;
    }
  }
  return null;
}

function colorFromNode(node, stateKey = null) {
  if (node?.__inheritColor) return "";
  if (stateKey && node?.__states && node.__states[stateKey]) {
    const stateNode = node.__states[stateKey];
    const stroke = visibleStroke(stateNode);
    if (stroke?.color) return rgba01ToCss(stroke.color);
    const fill = firstSolidFill(stateNode);
    if (fill && typeof fill.r === "number") {
      return rgba01ToCss({ r: fill.r, g: fill.g, b: fill.b, a: fill.a });
    }
  }
  const stroke = visibleStroke(node);
  if (stroke?.color) return rgba01ToCss(stroke.color);
  const fill = firstSolidFill(node);
  if (fill && typeof fill.r === "number") {
    return rgba01ToCss({ r: fill.r, g: fill.g, b: fill.b, a: fill.a });
  }
  return "";
}

function drawMode(node) {
  const stroke = visibleStroke(node);
  if (stroke) return { mode: "stroke", strokeWidth: Math.max(1, stroke.weight || 1) };
  const fill = firstSolidFill(node);
  if (fill) return { mode: "fill" };
  return { mode: "stroke", strokeWidth: 2 };
}

function stripOuterSvg(markup) {
  const s = String(markup || "").trim();
  if (!s) return "";
  if (s.startsWith("<svg")) return s;
  // If only inner markup, wrap it in a basic <svg>.
  return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

function sizeClassesFromNode(node) {
  const w = typeof node?.w === "number" && node.w > 0 ? node.w : null;
  const h = typeof node?.h === "number" && node.h > 0 ? node.h : null;

  // Prefer your manual arrow sizing: w-4 (~16px)
  const wc = w && Math.abs(w - 16) <= 1 ? "w-4" : w ? `w-[${rem(w)}]` : "w-4";
  const hc = h && Math.abs(h - 16) <= 1 ? "h-4" : h ? `h-[${rem(h)}]` : "";

  return cls("object-contain", "self-stretch", "my-auto", "shrink-0", wc, hc);
}

export function renderSvgLeaf(node) {
  const svg = node?.svg || node?.vector || null;
  if (!svg) return "";

  const stateClasses = node?.tw ? String(node.tw).trim() : "";
  const baseSizeClasses = sizeClassesFromNode(node);
  const allClasses = cls(baseSizeClasses, stateClasses);

  // Case 1: full markup
  if (svg.markup || svg.html) {
    const markup = stripOuterSvg(svg.markup || svg.html);
    if (!markup) return "";
    if (MAX_INLINE_DATA > 0 && markup.length > MAX_INLINE_DATA) return "";

    const classes = allClasses;
    const color = colorFromNode(node);

    if (markup.startsWith("<svg")) {
      const hasClass = /class=/.test(markup);
      const hasAria = /aria-/.test(markup);
      const hasStyle = /style=/.test(markup);
      const attrs = svgAttrString(node, classes, {
        includeClass: !hasClass,
        includeAria: !hasAria && !hasClass,
        style: !hasStyle && color ? `color:${color};` : "",
      });
      return markup.replace("<svg", `<svg${attrs}`);
    }

    return markup;
  }

  // Case 2: array of path d strings
  const paths =
    Array.isArray(svg.paths) ? svg.paths :
      Array.isArray(svg.path) ? svg.path :
        null;

  if (paths && paths.length) {
    const classes = allClasses;
    const color = colorFromNode(node);
    const mode = drawMode(node);
    const strokeAttrs =
      mode.mode === "stroke"
        ? ` stroke="currentColor" stroke-width="${mode.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"`
        : ` fill="currentColor"`;
    const dMarkup = paths
      .map((d) => {
        const dd = String(d || "").trim();
        if (!dd) return "";
        if (MAX_INLINE_DATA > 0 && dd.length > MAX_INLINE_DATA) return "";
        return `<path d="${escAttr(dd)}"${strokeAttrs}></path>`;
      })
      .filter(Boolean)
      .join("");

    if (!dMarkup) return "";

    const attrs = svgAttrString(node, classes, {
      includeClass: true,
      includeAria: true,
      style: color ? `color:${color};` : "",
    });
    return `<svg${attrs} width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${dMarkup}</svg>`;
  }

  // Case 3: single d string
  const d =
    typeof svg.d === "string" ? svg.d :
      typeof svg.pathD === "string" ? svg.pathD :
        "";

  if (d && d.trim()) {
    if (MAX_INLINE_DATA > 0 && d.length > MAX_INLINE_DATA) return "";
    const classes = allClasses;
    const color = colorFromNode(node);
    const mode = drawMode(node);
    const strokeAttrs =
      mode.mode === "stroke"
        ? ` stroke="currentColor" stroke-width="${mode.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"`
        : ` fill="currentColor"`;
    const attrs = svgAttrString(node, classes, {
      includeClass: true,
      includeAria: true,
      style: color ? `color:${color};` : "",
    });
    return `<svg${attrs} width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${escAttr(d.trim())}"${strokeAttrs}></path></svg>`;
  }

  return "";
}
