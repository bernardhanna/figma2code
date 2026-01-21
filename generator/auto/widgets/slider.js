// generator/auto/widgets/slider.js
import { cls } from "../autoLayoutify/precision.js";
import { parseWidgetDirective } from "./utils.js";

const SLIDER_TOKEN_RE = /\b(slider|carousel|slick)\b/i;
const SLIDES_GROUP_RE = /\b(slides|items|cards|carousel|track|list)\b/i;
const DOTS_RE = /\b(dots?|indicator|indicators|pagination|bullets?)\b/i;
const ARROW_RE = /\b(arrow|chevron|caret|prev|previous|next|left|right)\b/i;
const PREV_RE = /\b(prev|previous|left|back)\b/i;
const NEXT_RE = /\b(next|right|forward)\b/i;
const NO_ARROWS_RE = /\b(no[-\s]?arrows|noarrows)\b/i;
const NO_DOTS_RE = /\b(no[-\s]?dots|nodots)\b/i;
const ARROWS_ON_RE = /\b(arrows|nav|navigation)\b/i;
const DOTS_ON_RE = /\b(dots|indicators|pagination)\b/i;
const AUTOPLAY_RE = /\b(auto[-\s]?play|autoplay)\b/i;
const SLIDES_RE = /\bslides?\s*[-:=]?\s*(\d+)\b/i;
const CENTER_RE = /\b(center|centered|centre|center-mode)\b/i;
const FADE_RE = /\b(fade)\b/i;
const INFINITE_RE = /\b(infinite|loop)\b/i;
const NO_INFINITE_RE = /\b(no[-\s]?(infinite|loop))\b/i;

const AUTO_ENABLED = String(process.env.WIDGET_SLIDER_AUTO || "1").trim() !== "0";
const AUTO_MAX_CHILDREN = Number(process.env.WIDGET_SLIDER_MAX_CHILDREN) || 60;
const AUTO_MAX_NODES = Number(process.env.WIDGET_SLIDER_MAX_NODES) || 2500;
const ALLOW_NESTED = String(process.env.WIDGET_SLIDER_ALLOW_NESTED || "").trim() === "1";

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function lowerName(node) {
  return String(node?.name || "").toLowerCase();
}

function numPx(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nodeWidth(node) {
  return numPx(node?.w ?? node?.bb?.w);
}

function autoGapPx(node) {
  return numPx(node?.auto?.itemSpacing);
}

function median(values) {
  if (!values?.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function estimateGapPx(slides) {
  if (!slides || slides.length < 2) return 0;
  const points = slides
    .map((n) => ({
      x: numPx(n?.bb?.x ?? n?.x),
      w: numPx(n?.bb?.w ?? n?.w),
    }))
    .filter((p) => p.x >= 0 && p.w > 0)
    .sort((a, b) => a.x - b.x);
  if (points.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const gap = next.x - (prev.x + prev.w);
    if (gap > 0) gaps.push(gap);
  }
  return median(gaps);
}

function pickSlideWidth(slides) {
  const widths = (slides || []).map((n) => nodeWidth(n)).filter(Boolean);
  return median(widths);
}

function inferSlidesToShow(containerW, slideW, gap, total) {
  if (!containerW || !slideW) return null;
  const denom = slideW + (gap || 0);
  if (!denom) return null;
  const count = Math.max(1, Math.floor((containerW + (gap || 0)) / denom));
  if (total && count > total) return total;
  return count;
}

function appendStyleVar(attrs, name, value) {
  if (!attrs || typeof attrs !== "object") return;
  const prev = typeof attrs.style === "string" ? attrs.style.trim() : "";
  const sep = prev && !prev.endsWith(";") ? ";" : "";
  attrs.style = `${prev}${sep}${name}:${value};`;
}

function markSubtreeFlag(root, flag) {
  if (!root) return;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    cur[flag] = true;
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      stack.push(kids[i]);
    }
  }
}

function hasDirectiveDescendant(node) {
  let found = false;
  const seen = new Set();
  (function walk(n) {
    if (!n || found || seen.has(n)) return;
    seen.add(n);
    for (const c of n.children || []) {
      const parsed = parseWidgetDirective(c?.name);
      if (parsed?.type === "slider") {
        found = true;
        return;
      }
      walk(c);
    }
  })(node);
  return found;
}

function isSlidesGroup(node) {
  if (!node || !node.children || !node.children.length) return false;
  const name = lowerName(node);
  return SLIDES_GROUP_RE.test(name) && !DOTS_RE.test(name) && !ARROW_RE.test(name);
}

function pickSlidesGroup(children) {
  return (children || []).find((c) => isSlidesGroup(c)) || null;
}

function parseSliderOptions(name) {
  const lower = String(name || "").toLowerCase();
  const opts = {};

  if (NO_DOTS_RE.test(lower)) {
    opts.dots = false;
  } else if (DOTS_ON_RE.test(lower)) {
    opts.dots = true;
  }

  if (NO_ARROWS_RE.test(lower)) {
    opts.arrows = false;
  } else if (ARROWS_ON_RE.test(lower)) {
    opts.arrows = true;
  }

  if (AUTOPLAY_RE.test(lower)) {
    opts.autoplay = true;
  }

  const slidesMatch = lower.match(SLIDES_RE);
  if (slidesMatch && slidesMatch[1]) {
    const n = Number(slidesMatch[1]);
    if (Number.isFinite(n) && n > 0) opts.slidesToShow = n;
  }

  if (CENTER_RE.test(lower)) {
    opts.center = true;
  }

  if (FADE_RE.test(lower)) {
    opts.fade = true;
  }

  if (NO_INFINITE_RE.test(lower)) {
    opts.infinite = false;
  } else if (INFINITE_RE.test(lower)) {
    opts.infinite = true;
  }

  return opts;
}

function collectDescendantIds(node, set) {
  const seen = new Set();
  (function walk(n) {
    if (!n || seen.has(n)) return;
    seen.add(n);
    if (n.id) set.add(n.id);
    for (const c of n.children || []) walk(c);
  })(node);
}

function collectControls(root, excludeIds) {
  const arrows = [];
  const dots = [];
  const seen = new Set();
  let visited = 0;

  (function walk(n) {
    if (!n || seen.has(n)) return;
    if (visited >= AUTO_MAX_NODES) return;
    seen.add(n);
    visited += 1;
    if (n.id && excludeIds && excludeIds.has(n.id)) return;

    if (n !== root) {
      const name = lowerName(n);
      if (DOTS_RE.test(name)) dots.push(n);
      if (ARROW_RE.test(name)) arrows.push(n);
    }

    for (const c of n.children || []) walk(c);
  })(root);

  return { arrows, dots };
}

function isSlideCandidate(node) {
  if (!node || node.text) return false;
  const name = lowerName(node);
  if (DOTS_RE.test(name) || ARROW_RE.test(name)) return false;
  const w = Number(node?.w || node?.bb?.w || 0) || 0;
  const h = Number(node?.h || node?.bb?.h || 0) || 0;
  if (!w || !h) return false;
  return true;
}

function countSimilarSlides(nodes) {
  const candidates = (nodes || []).filter((n) => isSlideCandidate(n));
  if (candidates.length < 2) return 0;
  if (candidates.length > AUTO_MAX_CHILDREN) return 0;
  const base = candidates[0];
  const bw = Number(base?.w || base?.bb?.w || 0) || 0;
  const bh = Number(base?.h || base?.bb?.h || 0) || 0;
  if (!bw || !bh) return 0;

  const similar = candidates.filter((n) => {
    const w = Number(n?.w || n?.bb?.w || 0) || 0;
    const h = Number(n?.h || n?.bb?.h || 0) || 0;
    if (!w || !h) return false;
    const dw = Math.abs(w - bw) / Math.max(1, bw);
    const dh = Math.abs(h - bh) / Math.max(1, bh);
    return dw <= 0.35 && dh <= 0.35;
  });

  return similar.length;
}

function uniqueById(list) {
  const out = [];
  const seen = new Set();
  for (const n of list || []) {
    const id = n?.id || n;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(n);
  }
  return out;
}

function pickArrows(arrows) {
  const list = uniqueById(arrows);
  if (!list.length) return { prev: null, next: null };

  let prev = list.find((n) => PREV_RE.test(lowerName(n))) || null;
  let next = list.find((n) => NEXT_RE.test(lowerName(n))) || null;

  if ((!prev || !next) && list.length >= 2) {
    const sorted = list
      .slice()
      .sort((a, b) => (Number(a?.bb?.x || 0) || 0) - (Number(b?.bb?.x || 0) || 0));
    if (!prev) prev = sorted[0] || null;
    if (!next) next = sorted[sorted.length - 1] || null;
  }

  if (prev && next && prev === next) next = null;
  return { prev, next };
}

export const id = "slider";

export function match(node, ctx) {
  if (!node || node.text) return false;
  if (node.__widgetSkip) return false;
  if (node.__widgetDisableSlider && !ALLOW_NESTED) return false;
  if (node.__widgetApplied && node.__widgetApplied[id]) return false;

  const directive = parseWidgetDirective(node.name);
  const explicitToken = directive?.type === "slider" || SLIDER_TOKEN_RE.test(String(node?.name || ""));
  if (node.__widgetDisableSlider && !explicitToken) return false;
  if (explicitToken) return true;
  if (hasDirectiveDescendant(node)) return false;
  if (!AUTO_ENABLED) return false;

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length > AUTO_MAX_CHILDREN) return false;
  const slidesGroup = pickSlidesGroup(children);
  if (slidesGroup && countSimilarSlides(slidesGroup.children) >= 2) {
    const excludeIds = new Set();
    collectDescendantIds(slidesGroup, excludeIds);
    const { arrows, dots } = collectControls(node, excludeIds);
    if (arrows.length || dots.length) return true;
  }

  return false;
}

export function apply(node, ctx) {
  if (!node || node.text) return;

  const directive = parseWidgetDirective(node.name);
  const existing = isObj(node.__widget) ? node.__widget : null;

  node.__widget = {
    type: "slider",
    enhance: existing?.enhance || directive?.enhance || "slick",
    scope: existing?.scope || directive?.scope || "all",
    sourceName: existing?.sourceName || directive?.sourceName || String(node.name || "").trim(),
  };

  const baseId = String(node?.id || node?.name || "slider").replace(/\s+/g, "_");
  const children = Array.isArray(node.children) ? node.children.slice() : [];
  const slidesGroup = pickSlidesGroup(children);

  let sliderEl = slidesGroup;
  let slideNodes = [];

  if (slidesGroup) {
    slideNodes = Array.isArray(slidesGroup.children) ? slidesGroup.children.slice() : [];
  } else {
    const directControls = children.filter(
      (c) => DOTS_RE.test(lowerName(c)) || ARROW_RE.test(lowerName(c))
    );
    const controlIds = new Set(directControls.map((c) => c?.id).filter(Boolean));
    slideNodes = children.filter((c) => !controlIds.has(c?.id));

    sliderEl = {
      id: `${baseId}__slider`,
      name: `${node.name || "Slider"} Track`,
      type: "FRAME",
      w: node?.w,
      h: node?.h,
      children: slideNodes,
    };

    const insertAt = Math.max(children.findIndex((c) => slideNodes.includes(c)), 0);
    const remaining = children.filter((c) => !slideNodes.includes(c));
    remaining.splice(insertAt, 0, sliderEl);
    node.children = remaining;
  }

  if (!slideNodes.length) return;

  if (!isObj(sliderEl.__widgetApplied)) sliderEl.__widgetApplied = {};
  sliderEl.__widgetApplied[id] = true;

  if (!sliderEl.auto && slideNodes.length) {
    const baseAuto = node?.auto || {};
    sliderEl.auto = {
      layout: "HORIZONTAL",
      itemSpacing: autoGapPx(sliderEl) || autoGapPx(node) || estimateGapPx(slideNodes),
      primaryAlign: baseAuto.primaryAlign || "MIN",
      counterAlign: baseAuto.counterAlign || "CENTER",
    };
  }

  for (const slide of slideNodes) {
    markSubtreeFlag(slide, "__widgetDisableSlider");
  }

  const excludeIds = new Set();
  if (sliderEl) collectDescendantIds(sliderEl, excludeIds);

  const { arrows, dots } = collectControls(node, excludeIds);
  const { prev, next } = pickArrows(arrows);
  const dotsNode = uniqueById(dots)[0] || null;

  const options = parseSliderOptions(node.__widget.sourceName || node.name || "");
  const gapPx = autoGapPx(sliderEl) || autoGapPx(node) || estimateGapPx(slideNodes);
  const containerW = nodeWidth(sliderEl) || nodeWidth(node);
  const slideW = pickSlideWidth(slideNodes);
  if (!options.slidesToShow) {
    const inferred = inferSlidesToShow(containerW, slideW, gapPx, slideNodes.length);
    if (inferred) options.slidesToShow = inferred;
  }
  const arrowsEnabled = typeof options.arrows === "boolean" ? options.arrows : !!(prev || next);
  const dotsEnabled = typeof options.dots === "boolean" ? options.dots : !!dotsNode;

  if (!sliderEl.attrs || typeof sliderEl.attrs !== "object") sliderEl.attrs = {};
  sliderEl.attrs["data-widget"] = "slick";
  sliderEl.attrs["data-slick-id"] = baseId;
  sliderEl.attrs["data-slick-arrows"] = arrowsEnabled ? "1" : "0";
  sliderEl.attrs["data-slick-dots"] = dotsEnabled ? "1" : "0";
  if (gapPx > 0) {
    sliderEl.attrs["data-slick-gap"] = String(Math.round(gapPx));
    appendStyleVar(sliderEl.attrs, "--slick-gap", `${Math.round(gapPx)}px`);
  }
  if (options.autoplay) sliderEl.attrs["data-slick-autoplay"] = "1";
  if (options.slidesToShow) sliderEl.attrs["data-slick-slides"] = String(options.slidesToShow);
  if (options.center) sliderEl.attrs["data-slick-center"] = "1";
  if (options.fade) sliderEl.attrs["data-slick-fade"] = "1";
  if (typeof options.infinite === "boolean") {
    sliderEl.attrs["data-slick-infinite"] = options.infinite ? "1" : "0";
  }

  if (prev) {
    prev.attrs = { ...(prev.attrs || {}), "data-slick-prev": baseId };
  }
  if (next) {
    next.attrs = { ...(next.attrs || {}), "data-slick-next": baseId };
  }
  if (dotsNode) {
    dotsNode.attrs = { ...(dotsNode.attrs || {}), "data-slick-dots": baseId };
  }

  sliderEl.tw = cls(sliderEl.tw, "w-full", "min-w-0");

  if (prev || next || dotsNode) {
    node.tw = cls(node.tw, "relative");
  }
}

export default { id, match, apply };
