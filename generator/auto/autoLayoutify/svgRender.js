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

  // Case 1: full markup
  if (svg.markup || svg.html) {
    const markup = stripOuterSvg(svg.markup || svg.html);
    if (!markup) return "";

    const classes = sizeClassesFromNode(node);

    // Inject class + aria-hidden if the markup doesn't already define class.
    if (markup.startsWith("<svg") && !/class=/.test(markup)) {
      return markup.replace(
        "<svg",
        `<svg class="${escAttr(classes)}" aria-hidden="true"`
      );
    }

    return markup;
  }

  // Case 2: array of path d strings
  const paths =
    Array.isArray(svg.paths) ? svg.paths :
      Array.isArray(svg.path) ? svg.path :
        null;

  if (paths && paths.length) {
    const classes = sizeClassesFromNode(node);
    const dMarkup = paths
      .map((d) => {
        const dd = String(d || "").trim();
        if (!dd) return "";
        return `<path d="${escAttr(dd)}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
      })
      .filter(Boolean)
      .join("");

    if (!dMarkup) return "";

    return `<svg class="${escAttr(classes)}" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${dMarkup}</svg>`;
  }

  // Case 3: single d string
  const d =
    typeof svg.d === "string" ? svg.d :
      typeof svg.pathD === "string" ? svg.pathD :
        "";

  if (d && d.trim()) {
    const classes = sizeClassesFromNode(node);
    return `<svg class="${escAttr(classes)}" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${escAttr(d.trim())}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  }

  return "";
}
