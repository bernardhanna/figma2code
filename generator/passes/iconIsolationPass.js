function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nodeType(node) {
  return String(node?.type || "").trim().toUpperCase();
}

function hasTextContent(node) {
  if (!isObj(node)) return false;
  if (isObj(node.text) && String(node.text.raw || "").trim()) return true;
  if (nodeType(node) === "TEXT") return true;
  return false;
}

function hasAutoLayoutIntent(node) {
  if (!isObj(node)) return false;
  const autoLayout = String(node?.auto?.layout || "").trim().toUpperCase();
  if (autoLayout && autoLayout !== "NONE") return true;
  const axisHint = String(node?.__layoutHints?.axis || "").trim().toLowerCase();
  if (axisHint === "horizontal" || axisHint === "vertical") return true;
  return false;
}

function looksLikeTinyVisualLeaf(node) {
  const w = nodeWidth(node);
  const h = nodeHeight(node);
  return w > 0 && h > 0 && w <= 64 && h <= 64;
}

function hasLayoutSemanticRole(node) {
  if (!isObj(node)) return false;
  if (node?.actions?.isClickable || node?.actions?.openUrl) return true;
  const tag = String(node?.tag || "").trim().toLowerCase();
  if (tag && tag !== "div" && tag !== "span") return true;
  const role = String(node?.attrs?.role || node?.role || "").trim().toLowerCase();
  if (role) return true;
  return false;
}

function isVectorLikeLeaf(node) {
  if (!isObj(node)) return false;
  const t = nodeType(node);
  if (t === "VECTOR" || t === "BOOLEAN_OPERATION" || t === "LINE" || t === "STAR") return true;
  const imgSrc = String(node?.img?.src || "").trim();
  const name = String(node?.name || "").toLowerCase();
  const iconLikeImage =
    !!imgSrc &&
    (/\b(icon|vector|arrow|chevron|caret|glyph|logo|awareness|care)\b/.test(name) ||
      /\/assets\/(?:icon|vector|ellipse)-/i.test(imgSrc) ||
      looksLikeTinyVisualLeaf(node));
  if (iconLikeImage) return true;
  if (isObj(node.vector) || isObj(node.svg)) return true;
  return false;
}

function hasRenderableVectorData(node) {
  if (!isObj(node)) return false;
  if (typeof node?.svg === "string" && node.svg.trim()) return true;
  if (typeof node?.svg?.markup === "string" && node.svg.markup.trim()) return true;
  if (typeof node?.svg?.html === "string" && node.svg.html.trim()) return true;
  if (typeof node?.img?.src === "string" && node.img.src.trim()) return true;
  if (typeof node?.vector?.d === "string" && node.vector.d.trim()) return true;
  if (typeof node?.vector?.pathD === "string" && node.vector.pathD.trim()) return true;
  const paths = Array.isArray(node?.vector?.paths)
    ? node.vector.paths
    : Array.isArray(node?.vector?.path)
      ? node.vector.path
      : Array.isArray(node?.svg?.paths)
        ? node.svg.paths
        : Array.isArray(node?.svg?.path)
          ? node.svg.path
          : [];
  return paths.some((p) => String(p || "").trim());
}

function nodeWidth(node) {
  const w = toNum(node?.w, 0) || toNum(node?.bb?.w, 0);
  return w > 0 ? w : 0;
}

function nodeHeight(node) {
  const h = toNum(node?.h, 0) || toNum(node?.bb?.h, 0);
  return h > 0 ? h : 0;
}

function inspectIconSubtree(node, state, depth = 0) {
  if (!isObj(node)) return false;
  if (hasTextContent(node)) return false;
  if (hasAutoLayoutIntent(node)) {
    // Some icon instances come through with auto-layout metadata on root only.
    if (depth !== 0) return false;
  }
  if (hasLayoutSemanticRole(node)) return false;

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    if (!isVectorLikeLeaf(node)) return false;
    state.vectorCount += 1;
    state.maxDepth = Math.max(state.maxDepth, depth);
    if (hasRenderableVectorData(node)) state.renderableCount += 1;
    return true;
  }

  for (const child of children) {
    if (!inspectIconSubtree(child, state, depth + 1)) return false;
  }
  return true;
}

function escapeXmlAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function rgba01ToCss(rgba) {
  if (!isObj(rgba)) return "";
  const r = Math.round(Math.max(0, Math.min(1, Number(rgba.r) || 0)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, Number(rgba.g) || 0)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, Number(rgba.b) || 0)) * 255);
  const a = Math.max(0, Math.min(1, Number(rgba.a)));
  if (!Number.isFinite(a) || a >= 0.999) {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return `rgba(${r},${g},${b},${a})`;
}

function firstSolidFill(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : Array.isArray(node?.fill) ? node.fill : [];
  for (const fill of fills) {
    const kind = String(fill?.kind || fill?.type || fill?.fillType || "").toLowerCase();
    if (kind === "solid" || kind === "color") return fill;
  }
  return null;
}

function toTransformAttr(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length >= 6) {
    const nums = value.slice(0, 6).map((n) => Number(n));
    if (nums.every((n) => Number.isFinite(n))) {
      return `matrix(${nums.join(" ")})`;
    }
  }
  return "";
}

function parseInnerSvg(markup) {
  const raw = String(markup || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("<svg")) return raw;
  const start = raw.indexOf(">");
  const end = raw.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end <= start) return raw;
  return raw.slice(start + 1, end).trim();
}

function nodeOffsetWithin(node, rootX, rootY) {
  const relX = Number(node?.relX);
  const relY = Number(node?.relY);
  if (Number.isFinite(relX) || Number.isFinite(relY)) {
    return {
      x: Number.isFinite(relX) ? relX : 0,
      y: Number.isFinite(relY) ? relY : 0,
    };
  }
  const bb = isObj(node?.bb) ? node.bb : null;
  const x = Number(bb?.x);
  const y = Number(bb?.y);
  if (Number.isFinite(x) || Number.isFinite(y)) {
    return {
      x: (Number.isFinite(x) ? x : rootX) - rootX,
      y: (Number.isFinite(y) ? y : rootY) - rootY,
    };
  }
  return { x: 0, y: 0 };
}

function renderVectorPaths(node) {
  const vector = isObj(node?.vector) ? node.vector : isObj(node?.svg) ? node.svg : {};
  const paths = Array.isArray(vector?.paths)
    ? vector.paths
    : Array.isArray(vector?.path)
      ? vector.path
      : [];
  const singlePath = typeof vector?.d === "string" && vector.d.trim()
    ? [vector.d]
    : typeof vector?.pathD === "string" && vector.pathD.trim()
      ? [vector.pathD]
      : [];
  const list = [...paths, ...singlePath].map((p) => String(p || "").trim()).filter(Boolean);
  if (!list.length) return "";

  const stroke = isObj(node?.stroke) ? node.stroke : null;
  const strokeColor = stroke?.color ? rgba01ToCss(stroke.color) : "";
  const strokeWidth = Number(stroke?.weight);
  const strokeLinecap = String(
    node?.strokeLinecap || stroke?.lineCap || stroke?.strokeLinecap || ""
  ).trim();
  const strokeLinejoin = String(
    node?.strokeLinejoin || stroke?.lineJoin || stroke?.strokeLinejoin || ""
  ).trim();
  const fill = firstSolidFill(node);
  const fillColor = fill ? rgba01ToCss(fill) : "";
  const fillRule = String(node?.fillRule || node?.windingRule || "").trim();

  const styleAttrs = [];
  styleAttrs.push(`fill="${escapeXmlAttr(fillColor || "none")}"`);
  if (strokeColor) styleAttrs.push(`stroke="${escapeXmlAttr(strokeColor)}"`);
  if (Number.isFinite(strokeWidth) && strokeWidth > 0) {
    styleAttrs.push(`stroke-width="${escapeXmlAttr(strokeWidth)}"`);
  }
  if (strokeLinecap) styleAttrs.push(`stroke-linecap="${escapeXmlAttr(strokeLinecap)}"`);
  if (strokeLinejoin) styleAttrs.push(`stroke-linejoin="${escapeXmlAttr(strokeLinejoin)}"`);
  if (fillRule) styleAttrs.push(`fill-rule="${escapeXmlAttr(fillRule)}"`);

  const markerEnd = String(node?.markerEnd || node?.marker?.end || "").trim();
  if (markerEnd) styleAttrs.push(`marker-end="${escapeXmlAttr(markerEnd)}"`);
  const clipPath = String(node?.clipPath || node?.clipPathRef || "").trim();
  if (clipPath) styleAttrs.push(`clip-path="${escapeXmlAttr(clipPath)}"`);
  const mask = String(node?.mask || node?.maskRef || "").trim();
  if (mask) styleAttrs.push(`mask="${escapeXmlAttr(mask)}"`);

  return list
    .map((d) => `<path d="${escapeXmlAttr(d)}" ${styleAttrs.join(" ")} />`)
    .join("");
}

function renderImageLayer(node, rootX, rootY) {
  const src = String(node?.img?.src || "").trim();
  if (!src) return "";
  const offset = nodeOffsetWithin(node, rootX, rootY);
  const w = toNum(node?.w, 0) || toNum(node?.img?.w, 0) || toNum(node?.bb?.w, 0);
  const h = toNum(node?.h, 0) || toNum(node?.img?.h, 0) || toNum(node?.bb?.h, 0);
  if (!(w > 0) || !(h > 0)) return "";
  return `<image href="${escapeXmlAttr(src)}" x="${escapeXmlAttr(offset.x)}" y="${escapeXmlAttr(offset.y)}" width="${escapeXmlAttr(w)}" height="${escapeXmlAttr(h)}" preserveAspectRatio="none" />`;
}

function collectSvgLayers(node, rootX, rootY, out, stats) {
  if (!isObj(node)) return;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length) {
    for (const child of children) collectSvgLayers(child, rootX, rootY, out, stats);
    return;
  }

  const markup =
    (typeof node?.svg === "string" && node.svg.trim()) ||
    (typeof node?.svg?.markup === "string" && node.svg.markup.trim()) ||
    (typeof node?.svg?.html === "string" && node.svg.html.trim()) ||
    "";
  const imageLayer = renderImageLayer(node, rootX, rootY);
  const innerMarkup = markup ? parseInnerSvg(markup) : renderVectorPaths(node) || imageLayer;
  if (!innerMarkup) return;

  // Image layers are already fully placed in icon coordinates.
  if (innerMarkup.startsWith("<image ")) {
    if (stats) stats.imageLayerCount = Number(stats.imageLayerCount || 0) + 1;
    out.push(innerMarkup);
    return;
  }

  const offset = nodeOffsetWithin(node, rootX, rootY);
  const translate = `translate(${offset.x} ${offset.y})`;
  const localTransform = toTransformAttr(node?.transform || node?.matrix);
  const transform = localTransform ? `${translate} ${localTransform}` : translate;
  out.push(`<g transform="${escapeXmlAttr(transform)}">${innerMarkup}</g>`);
}

export function isIconCandidate(node, options = {}) {
  if (!isObj(node)) return false;
  if (nodeType(node) === "TEXT") return false;
  if (nodeType(node) === "SVG") return false;
  const width = nodeWidth(node);
  const height = nodeHeight(node);
  const maxArea = Number.isFinite(Number(options?.maxArea))
    ? Number(options.maxArea)
    : Number(process.env.ICON_ISOLATION_MAX_AREA || 250000);
  if (width <= 0 || height <= 0) return false;
  if (width * height > maxArea) return false;

  const state = { vectorCount: 0, renderableCount: 0, maxDepth: 0 };
  if (!inspectIconSubtree(node, state, 0)) return false;
  if (state.vectorCount < 1) return false;
  if (state.renderableCount < 1) return false;
  return true;
}

function isolateIconNode(node) {
  const width = nodeWidth(node);
  const height = nodeHeight(node);
  const bb = isObj(node?.bb)
    ? { ...node.bb, w: width || toNum(node.bb.w, 0), h: height || toNum(node.bb.h, 0) }
    : undefined;
  const rootX = toNum(node?.bb?.x, 0);
  const rootY = toNum(node?.bb?.y, 0);
  const layers = [];
  const stats = { imageLayerCount: 0 };
  collectSvgLayers(node, rootX, rootY, layers, stats);
  if (!layers.length) return null;

  const svgMarkup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeXmlAttr(width)}" height="${escapeXmlAttr(height)}" ` +
    `viewBox="0 0 ${escapeXmlAttr(width)} ${escapeXmlAttr(height)}" preserveAspectRatio="xMidYMid meet">` +
    layers.join("") +
    `</svg>`;

  const isolated = {
    id: node.id,
    name: node.name,
    type: "svg",
    w: width,
    h: height,
    svg: svgMarkup,
    children: [],
    __lockedLayout: true,
  };
  if (bb) isolated.bb = bb;
  if (typeof node?.relX !== "undefined") isolated.relX = node.relX;
  if (typeof node?.relY !== "undefined") isolated.relY = node.relY;
  if (typeof node?.key === "string" && node.key) isolated.key = node.key;
  if (typeof node?.tw === "string" && node.tw) isolated.tw = node.tw;
  if (isObj(node?.attrs)) isolated.attrs = { ...node.attrs };
  if (isObj(node?.dataAttrs)) isolated.dataAttrs = { ...node.dataAttrs };
  if (Array.isArray(node?.fills)) isolated.fills = node.fills.map((f) => ({ ...f }));
  if (Array.isArray(node?.fill)) isolated.fill = node.fill.map((f) => ({ ...f }));
  if (isObj(node?.stroke)) isolated.stroke = { ...node.stroke };
  if (isObj(node?.r)) isolated.r = { ...node.r };
  if (typeof node?.cornerRadius === "number") isolated.cornerRadius = node.cornerRadius;
  if (typeof node?.opacity === "number") isolated.opacity = node.opacity;
  if (typeof node?.blendMode === "string" && node.blendMode) isolated.blendMode = node.blendMode;
  if (stats.imageLayerCount > 0 && String(process.env.ICON_ISOLATION_DEBUG || "").trim() === "1") {
    console.warn(
      `[icon-isolation] consolidated raster/icon shards: id=${String(node?.id || "")} name="${String(
        node?.name || ""
      )}" layers=${stats.imageLayerCount}`
    );
  }
  return isolated;
}

function cloneWithoutChildren(node) {
  const out = { ...node };
  delete out.children;
  return out;
}

function walkAndIsolate(node, options) {
  if (!isObj(node)) return node;
  if (isIconCandidate(node, options)) {
    const isolated = isolateIconNode(node);
    if (isolated) return isolated;
  }

  const next = cloneWithoutChildren(node);
  if (Array.isArray(node.children)) {
    next.children = node.children.map((child) => walkAndIsolate(child, options)).filter(Boolean);
  }
  return next;
}

export function iconIsolationPass(ast, options = {}) {
  if (!isObj(ast) || !isObj(ast.tree)) return ast;
  const out = { ...ast };
  out.tree = walkAndIsolate(ast.tree, options);
  return out;
}

