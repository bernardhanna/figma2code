// generator/auto/normalizeAst.js
//
// Normalizes raw figma AST into something renderable.
//
// IMPORTANT FIXES:
// 1) Preserve/extract CTA text from rasterized INSTANCE nodes.
// 2) Normalize TEXT color into hex so renderer emits Tailwind `text-[#...]`.
// 3) Extract stable node key from layer name token like "#hero_title".
//    Example: "Title #hero_title" => node.key = "hero_title"
// 4) NEW (background regression fix):
//    - If the ROOT node has an IMAGE fill, force ast.__bg from that fill (enabled=true).
//    - If no IMAGE fill is found, DO NOT inject/fallback to frame export background.
//      (ast.__bg will be disabled/empty unless explicitly set elsewhere.)
//
// Assumptions:
// - Input nodes match your exported schema (id/type/name/children/text/typography/img/actions/auto/etc).
// - This file is invoked before autoLayoutify/render.
//

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const MAX_INLINE_DATA = Number(process.env.MAX_INLINE_DATA || 200000);

function isLargeDataUrl(value) {
  const s = typeof value === "string" ? value : "";
  if (!s) return false;
  if (!s.startsWith("data:")) return false;
  if (MAX_INLINE_DATA <= 0) return false;
  return s.length > MAX_INLINE_DATA;
}

function stripLargeInlineDataFromFill(fill) {
  if (!isObj(fill)) return fill;
  const f = { ...fill };
  if (isLargeDataUrl(f.src)) f.src = "";
  if (isLargeDataUrl(f.imageSrc)) f.imageSrc = "";
  if (isObj(f.image) && isLargeDataUrl(f.image.src)) {
    f.image = { ...f.image, src: "" };
  }
  if (isObj(f.asset) && isLargeDataUrl(f.asset.src)) {
    f.asset = { ...f.asset, src: "" };
  }
  if (isObj(f.file) && isLargeDataUrl(f.file.src)) {
    f.file = { ...f.file, src: "" };
  }
  return f;
}

function stripLargeInlineData(node) {
  if (!isObj(node)) return node;
  if (isObj(node.img) && isLargeDataUrl(node.img.src)) {
    node.img = { ...node.img, src: "" };
  }
  if (isObj(node.svg)) {
    if (isLargeDataUrl(node.svg.markup)) node.svg = { ...node.svg, markup: "" };
    if (isLargeDataUrl(node.svg.html)) node.svg = { ...node.svg, html: "" };
  }
  if (Array.isArray(node.fills)) {
    node.fills = node.fills.map(stripLargeInlineDataFromFill);
  }
  if (Array.isArray(node.fill)) {
    node.fill = node.fill.map(stripLargeInlineDataFromFill);
  }
  return node;
}

function rgba01ToHex(rgba) {
  if (!isObj(rgba)) return null;
  const r = rgba.r,
    g = rgba.g,
    b = rgba.b;

  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return null;

  const to = (v01) =>
    Math.round(clamp01(v01) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Extract stable key from `name` using #token convention.
 * - "Title #hero_title" => "hero_title"
 */
function extractNodeKeyFromName(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  const m = s.match(/#([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

function walkCollectText(n, out = [], seen = new Set()) {
  if (!n || seen.has(n)) return out;
  seen.add(n);
  if (isObj(n.text) && typeof n.text.raw === "string" && n.text.raw.trim()) out.push(n);
  for (const c of n.children || []) walkCollectText(c, out, seen);
  return out;
}

function firstNonGenericLabel(candidate) {
  const s = String(candidate || "").trim();
  if (!s) return "";

  // avoid common component instance names that are not real labels
  const bad = new Set(["CTA Button", "Button", "button", "CTA", "Primary", "Secondary"]);
  if (bad.has(s)) return "";

  return s;
}

function normalizeTypographyFromTextNode(textNode) {
  if (!textNode) return null;

  const t = textNode.text || {};
  const typo = textNode.typography || {};

  const existingHex = typo.colorHex || t.colorHex || t.fillHex;
  const derivedHex = !existingHex ? rgba01ToHex(t.color) : null;
  const colorHex = existingHex || derivedHex || undefined;

  return {
    family: typo.family || t.family || t.fontFamily || t.fontName?.family || undefined,
    sizePx: typeof typo.sizePx === "number" ? typo.sizePx : t.fontSize,
    lineHeightPx:
      typeof typo.lineHeightPx === "number"
        ? typo.lineHeightPx
        : typeof t.lineHeightPx === "number"
          ? t.lineHeightPx
          : undefined,
    weight: typeof typo.weight === "number" ? typo.weight : t.fontWeight,
    letterSpacingPx:
      typeof typo.letterSpacingPx === "number"
        ? typo.letterSpacingPx
        : typeof t.letterSpacingPx === "number"
          ? t.letterSpacingPx
          : 0,
    colorHex,
    italic: !!t.italic,
    uppercase: !!t.uppercase,
    decoration: t.decoration || "none",
    align: t.align || "left",
  };
}

function normalizeTextColorOnNode(node) {
  if (!isObj(node) || !isObj(node.text)) return;

  const t = node.text;
  const typo = isObj(node.typography) ? node.typography : null;

  const already =
    !!(typo && typeof typo.colorHex === "string" && typo.colorHex.trim()) ||
    !!(typeof t.colorHex === "string" && t.colorHex.trim()) ||
    !!(typeof t.fillHex === "string" && t.fillHex.trim());

  if (already) return;

  const hex = rgba01ToHex(t.color);
  if (!hex) return;

  t.fillHex = hex;

  if (!node.typography || !isObj(node.typography)) node.typography = {};
  if (!node.typography.colorHex) node.typography.colorHex = hex;
}

/* ---------------------------------------------
 * CTA recovery for rasterized/clickable INSTANCE
 * --------------------------------------------- */

function recoverCtaFromInstance(node) {
  const texts = walkCollectText(node, [], new Set());
  if (texts.length) {
    const label = firstNonGenericLabel(texts[0].text?.raw);
    if (label) {
      return { label, typography: normalizeTypographyFromTextNode(texts[0]) };
    }
  }

  if (Array.isArray(node.__instanceText) && node.__instanceText.length) {
    const first = node.__instanceText.find((x) => x && x.raw && String(x.raw).trim());
    if (first) {
      const label = firstNonGenericLabel(first.raw);
      if (label) {
        return {
          label,
          typography: {
            family: first.family,
            sizePx: first.fontSize,
            lineHeightPx: first.lineHeightPx,
            weight: first.fontWeight,
            letterSpacingPx: first.letterSpacingPx || 0,
            colorHex: first.colorHex || undefined,
            italic: !!first.italic,
            uppercase: !!first.uppercase,
            decoration: first.decoration || "none",
            align: first.align || "left",
          },
        };
      }
    }
  }

  if (isObj(node.componentText) && node.componentText.raw) {
    const label = firstNonGenericLabel(node.componentText.raw);
    if (label) {
      return {
        label,
        typography: {
          family: node.componentText.family,
          sizePx: node.componentText.fontSize,
          lineHeightPx: node.componentText.lineHeightPx,
          weight: node.componentText.fontWeight,
          letterSpacingPx: node.componentText.letterSpacingPx || 0,
          colorHex: node.componentText.colorHex || undefined,
          italic: !!node.componentText.italic,
          uppercase: !!node.componentText.uppercase,
          decoration: node.componentText.decoration || "none",
          align: node.componentText.align || "left",
        },
      };
    }
  }

  const fromName = firstNonGenericLabel(node.name);
  if (fromName) return { label: fromName, typography: null };

  return null;
}

/* ---------------------------------------------
 * Background extraction (ROOT IMAGE FILL -> ast.__bg)
 * --------------------------------------------- */

function isFillImage(fill) {
  if (!fill || typeof fill !== "object") return false;
  const t = String(fill.type || fill.fillType || "").toUpperCase();
  return t === "IMAGE" || t === "IMAGE_FILL";
}

function firstImageFill(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : Array.isArray(node?.fill) ? node.fill : [];

  for (const f of fills) {
    if (!isFillImage(f)) continue;

    // exporters vary wildly; try common keys:
    const src =
      (typeof f.src === "string" && f.src.trim()) ||
      (typeof f.url === "string" && f.url.trim()) ||
      (typeof f.imageUrl === "string" && f.imageUrl.trim()) ||
      (typeof f.image?.src === "string" && f.image.src.trim()) ||
      "";

    if (!src) continue;

    const objectFit = String(f.objectFit || f.scaleMode || "cover").toLowerCase();
    const objectPosition = String(f.objectPosition || f.position || "center");

    return { src, objectFit, objectPosition };
  }

  // sometimes fill image ends up on node.img
  const nsrc = typeof node?.img?.src === "string" ? node.img.src.trim() : "";
  if (nsrc) return { src: nsrc, objectFit: "cover", objectPosition: "center" };

  return null;
}

function pickRootNodeForBg(ast) {
  return ast?.tree || ast?.root || ast?.frameNode || ast?.node || null;
}

function enforceBgFromFill(ast) {
  const root = pickRootNodeForBg(ast);
  if (!root) return;

  const fillBg = firstImageFill(root);

  // If we find a fill image, force __bg to it and enable.
  if (fillBg?.src) {
    ast.__bg = {
      enabled: true,
      src: fillBg.src,
      objectFit: fillBg.objectFit || "cover",
      objectPosition: fillBg.objectPosition || "center",
      source: "fill",
    };
    return;
  }

  // No fill found: do NOT allow fallback backgrounds to creep in.
  if (ast.__bg) {
    ast.__bg.enabled = false;
    ast.__bg.src = "";
    if (!ast.__bg.objectFit) ast.__bg.objectFit = "cover";
    if (!ast.__bg.objectPosition) ast.__bg.objectPosition = "center";
    if (!ast.__bg.source) ast.__bg.source = "none";
  }
}

/* ---------------------------------------------
 * Main node normalization
 * --------------------------------------------- */

function normalizeNode(node, seen = new Map()) {
  if (!isObj(node)) return node;
  if (seen.has(node)) return seen.get(node);

  const n = { ...node };
  seen.set(node, n);

  stripLargeInlineData(n);

  // stable key extraction
  const k = extractNodeKeyFromName(n.name);
  if (k) n.key = k;

  if (Array.isArray(n.children)) {
    n.children = n.children.map((c) => normalizeNode(c, seen)).filter(Boolean);
  }

  normalizeTextColorOnNode(n);

  const isClickable = !!n.actions?.isClickable;
  const isInstance = String(n.type || "").toUpperCase() === "INSTANCE";

  if (isInstance && isClickable) {
    const recovered = recoverCtaFromInstance(n);
    if (recovered && recovered.label) {
      n.cta = {
        label: recovered.label,
        typography: recovered.typography || undefined,
      };

      if (n.cta.typography && !n.cta.typography.colorHex && isObj(n.text)) {
        const hex = rgba01ToHex(n.text.color);
        if (hex) n.cta.typography.colorHex = hex;
      }
    }
  }

  return n;
}

export function normalizeAst(ast) {
  if (!isObj(ast)) return ast;

  const out = { ...ast };
  if (isObj(out.tree)) out.tree = normalizeNode(out.tree);

  // NEW: enforce background selection rules
  enforceBgFromFill(out);

  return out;
}
