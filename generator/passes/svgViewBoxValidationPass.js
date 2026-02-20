function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pickPositiveDimension(primary, secondary, fallback) {
  const a = Number(primary);
  if (Number.isFinite(a) && a > 0) return a;
  const b = Number(secondary);
  if (Number.isFinite(b) && b > 0) return b;
  return fallback;
}

function stripRootStyleNoise(svgMarkup) {
  const source = String(svgMarkup || "");
  if (!source.startsWith("<svg")) return source;
  return source.replace(/<svg\b([^>]*)>/i, (full, attrs) => {
    const styleMatch = String(attrs || "").match(/\sstyle=(["'])([\s\S]*?)\1/i);
    if (!styleMatch) return full;
    const quote = styleMatch[1];
    const styleBody = String(styleMatch[2] || "");
    const kept = styleBody
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .filter((chunk) => !/^(?:width|height|max-width|max-height)\s*:/i.test(chunk));
    const nextStyle = kept.length ? ` style=${quote}${kept.join("; ")}${quote}` : "";
    const styleToken = styleMatch[0];
    return `<svg${String(attrs).replace(styleToken, nextStyle)}>`;
  });
}

function upsertSvgRootAttr(svgMarkup, key, value) {
  const source = String(svgMarkup || "");
  if (!source.startsWith("<svg")) return source;
  const attrRe = new RegExp(`\\s${key}=(["'])[^"']*\\1`, "i");
  if (attrRe.test(source)) {
    return source.replace(attrRe, ` ${key}="${value}"`);
  }
  return source.replace(/<svg\b/i, `<svg ${key}="${value}"`);
}

function normalizeSvgMarkup(markup, width, height) {
  let svg = String(markup || "").trim();
  if (!svg) return svg;
  if (!svg.startsWith("<svg")) return svg;

  const viewBox = `0 0 ${width} ${height}`;
  svg = upsertSvgRootAttr(svg, "viewBox", viewBox);
  svg = upsertSvgRootAttr(svg, "width", String(width));
  svg = upsertSvgRootAttr(svg, "height", String(height));
  svg = upsertSvgRootAttr(svg, "preserveAspectRatio", "xMidYMid meet");
  svg = stripRootStyleNoise(svg);
  return svg;
}

function walk(node) {
  if (!isObj(node)) return node;
  const out = { ...node };
  if (Array.isArray(node.children)) {
    out.children = node.children.map((child) => walk(child));
  }

  const type = String(node?.type || "").toLowerCase();
  if (type !== "svg") return out;

  const width = pickPositiveDimension(node?.w, node?.bb?.w, 16);
  const height = pickPositiveDimension(node?.h, node?.bb?.h, 16);
  out.w = width;
  out.h = height;
  if (isObj(out.bb)) {
    out.bb = {
      ...out.bb,
      w: toPositiveNumber(out.bb.w, width),
      h: toPositiveNumber(out.bb.h, height),
    };
  }
  if (typeof node?.svg === "string") {
    out.svg = normalizeSvgMarkup(node.svg, width, height);
  } else if (isObj(node?.svg)) {
    out.svg = { ...node.svg };
    if (typeof out.svg.markup === "string") {
      out.svg.markup = normalizeSvgMarkup(out.svg.markup, width, height);
    }
    if (typeof out.svg.html === "string") {
      out.svg.html = normalizeSvgMarkup(out.svg.html, width, height);
    }
  }
  return out;
}

export function svgViewBoxValidationPass(ast) {
  if (!isObj(ast) || !isObj(ast.tree)) return ast;
  const out = { ...ast };
  out.tree = walk(ast.tree);
  return out;
}

