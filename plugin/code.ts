// plugin/code.ts — Figma → AST exporter (strict types, semantics-ready)
// Includes Phase-1 bounding boxes (bb), hides hidden nodes, rasterizes complex nodes.
// PATCHED:
// - Export ALL visible fills (not just last paint) so gradient+image can be represented.
// - If node has image fill, exportPNG to get img.src BUT still traverse children for containers.
// - Fix TS error around FetchResponse.headers by using safe any casts.
// - NEW: Export a reference overlay image of the selected FRAME for pixel-compare in preview.
// - FIX: Remove direct TextDecoder usage so `tsc` works without DOM lib.
// - NEW (CTA fix): INSTANCE nodes are rasterized, but we ALSO export their descendant TEXT runs
//   as `__instanceText` so the generator can render button labels (instead of empty <button/>).

figma.showUI(__html__, { width: 440, height: 420 });

/** ===== Exported AST types ===== */
type SolidFill = { kind: "solid"; r: number; g: number; b: number; a: number };
type ImageFill = {
  kind: "image";
  scaleMode?: "FILL" | "FIT" | "TILE" | "STRETCH" | "CROP";

  // NEW: pointer to original bitmap in Figma
  imageHash?: string;

  // NEW: uploaded URL (served by generator)
  src?: string;
};
type LinearGradient = {
  kind: "gradient";
  type: "LINEAR";
  angle: number;
  stops: { r: number; g: number; b: number; a: number; pos: number }[];
};
type RadialGradient = {
  kind: "gradient";
  type: "RADIAL";
  cx: number;
  cy: number;
  stops: { r: number; g: number; b: number; a: number; pos: number }[];
};
type NoneFill = { kind: "none" };
type Fill = SolidFill | ImageFill | LinearGradient | RadialGradient | NoneFill;

type AutoLayout = {
  layout: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  padT?: number;
  padR?: number;
  padB?: number;
  padL?: number;
  primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAlign?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  primarySizing?: "HUG" | "FIXED";
  counterSizing?: "HUG" | "FIXED";
};

type Sizing = {
  primary?: "HUG" | "FIXED" | "FILL";
  counter?: "HUG" | "FIXED";
  w?: number;
  h?: number;
  align?: "MIN" | "CENTER" | "MAX" | "BASELINE" | "STRETCH";
};

type Shadow = {
  inset?: boolean;
  x: number;
  y: number;
  blur: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

type Stroke = {
  weight: number;
  align?: "INSIDE" | "CENTER" | "OUTSIDE";
  color?: { r: number; g: number; b: number; a: number };
};

type Radius = { tl?: number; tr?: number; br?: number; bl?: number };

type BlurInfo = { type: "LAYER" | "BACKGROUND"; radius: number };

type TextPayload = {
  raw: string;
  family?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number; // ✅ FIX
  align?: "left" | "center" | "right";
  color?: { r: number; g: number; b: number; a: number };
  italic?: boolean;
  decoration?: "none" | "underline" | "line-through";
  uppercase?: boolean;
};

type ExportedImage = { src: string; w: number; h: number };

type Actions = { openUrl?: string; isClickable?: boolean };

type BB = { x: number; y: number; w: number; h: number };

type NodeBase = {
  id: string;
  name: string;
  type: string;
  w: number;
  h: number;

  // Phase-1 / debug
  bb?: BB;

  auto?: AutoLayout;
  size?: Sizing;
  fills?: Fill[];

  stroke?: Stroke;
  r?: Radius;

  shadows?: Shadow[];
  opacity?: number;
  blendMode?: string;
  blur?: BlurInfo;
  clipsContent?: boolean;

  text?: TextPayload;
  img?: ExportedImage;

  actions?: Actions;

  // NEW: for rasterized INSTANCE (e.g., CTAs), preserve label text runs for generator
  __instanceText?: TextPayload[];

  children?: NodeBase[];
};

type Slots = {
  heading?: string;
  subcopy?: string;
  cta_primary?: string;
  image_main?: string;
};

type Meta = {
  schema: "figma-ast" | "raw-figma-ast";
  version: 1;
  exportedAt: string;
  figma?: { pageName?: string; frameName?: string };
  // NEW: reference overlay image for preview comparison
  overlay?: { src: string; w: number; h: number };
};

type AST = {
  slug: string;
  type: "flexi_block" | "navbar" | "footer";
  frame: { w: number; h: number };
  tree: NodeBase;
  slots: Slots;
  meta?: Meta;
};

/** ===== Helpers ===== */
const round = (n: number): number => Math.round(n * 1000) / 1000;

function rgbaFromRGB(rgb: RGB, alpha?: number) {
  return {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    a: typeof alpha === "number" ? alpha : 1,
  };
}

/**
 * UTF-8 decoder that does NOT rely on TextDecoder (so `tsc` works without DOM lib).
 * Good enough for SVG markup bytes.
 */
function decodeUtf8(bytes: Uint8Array): string {
  // Fast path for pure ASCII
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // Minimal UTF-8 decode
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];

    if (c < 0x80) {
      out += String.fromCharCode(c);
      continue;
    }

    if (c >= 0xc0 && c < 0xe0) {
      const c2 = bytes[i++] & 0x3f;
      const code = ((c & 0x1f) << 6) | c2;
      out += String.fromCharCode(code);
      continue;
    }

    if (c >= 0xe0 && c < 0xf0) {
      const c2 = bytes[i++] & 0x3f;
      const c3 = bytes[i++] & 0x3f;
      const code = ((c & 0x0f) << 12) | (c2 << 6) | c3;
      out += String.fromCharCode(code);
      continue;
    }

    // 4-byte → surrogate pair
    const c2 = bytes[i++] & 0x3f;
    const c3 = bytes[i++] & 0x3f;
    const c4 = bytes[i++] & 0x3f;
    const u = ((c & 0x07) << 18) | (c2 << 12) | (c3 << 6) | c4;

    const codepoint = u - 0x10000;
    const hi = 0xd800 + ((codepoint >> 10) & 0x3ff);
    const lo = 0xdc00 + (codepoint & 0x3ff);
    out += String.fromCharCode(hi, lo);
  }
  return out;
}

function sizeOf(n: SceneNode): { w: number; h: number } {
  const anyN = n as unknown as { width?: number; height?: number };
  const w = typeof anyN.width === "number" ? anyN.width : 0;
  const h = typeof anyN.height === "number" ? anyN.height : 0;
  return { w: round(w), h: round(h) };
}

function absBB(n: SceneNode): BB | undefined {
  try {
    const bb = (n as any).absoluteBoundingBox as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    if (!bb) return undefined;
    return {
      x: round(bb.x),
      y: round(bb.y),
      w: round(bb.width),
      h: round(bb.height),
    };
  } catch {
    return undefined;
  }
}

function isNodeVisible(n: SceneNode): boolean {
  try {
    if ((n as any).visible === false) return false;
    const o = (n as any).opacity as number | undefined;
    if (typeof o === "number" && o <= 0.001) return false;
    return true;
  } catch {
    return true;
  }
}

function letterSpacingToPx(textNode: TextNode): number | undefined {
  const ls = (textNode as any).letterSpacing;
  if (!ls || typeof ls.value !== "number") return undefined;

  const v = ls.value as number;
  const unit = String(ls.unit || "PIXELS").toUpperCase();

  // PIXELS: already px
  if (unit === "PIXELS") return v;

  // PERCENT: convert percent-of-font-size -> px
  if (unit === "PERCENT") {
    const fs = (textNode as any).fontSize;
    if (typeof fs === "number") return (fs * v) / 100;
  }

  // fallback
  return v;
}

/**
 * Pixel-fidelity: rasterize these types even when they don't have image fills,
 * because converting vectors/instances into Tailwind boxes is not reliable.
 */
function shouldRasterizeNode(node: SceneNode): boolean {
  const t = node.type;
  return (
    t === "INSTANCE" ||
    t === "VECTOR" ||
    t === "BOOLEAN_OPERATION" ||
    t === "STAR" ||
    t === "LINE" ||
    t === "ELLIPSE" ||
    t === "POLYGON"
  );
}

function getAutoLayout(n: SceneNode): AutoLayout | undefined {
  if (!("layoutMode" in (n as any))) return;

  const anyN = n as any;
  const mode = anyN.layoutMode as "HORIZONTAL" | "VERTICAL" | "NONE";
  if (!mode) return { layout: "NONE" };

  return {
    layout: mode,
    itemSpacing: anyN.itemSpacing ?? 0,
    padT: anyN.paddingTop ?? 0,
    padR: anyN.paddingRight ?? 0,
    padB: anyN.paddingBottom ?? 0,
    padL: anyN.paddingLeft ?? 0,
    primaryAlign: anyN.primaryAxisAlignItems ?? "MIN",
    counterAlign: anyN.counterAxisAlignItems ?? "MIN",
    primarySizing: anyN.primaryAxisSizingMode === "AUTO" ? "HUG" : "FIXED",
    counterSizing: anyN.counterAxisSizingMode === "AUTO" ? "HUG" : "FIXED",
  };
}

function childSizingInParent(
  parent: SceneNode,
  child: SceneNode
): Sizing | undefined {
  if (!("layoutMode" in (parent as any))) return;
  const anyP = parent as any;
  const mode = anyP.layoutMode as "HORIZONTAL" | "VERTICAL" | "NONE";
  if (!mode || mode === "NONE") return;

  const anyC = child as any;
  const layoutGrow = anyC.layoutGrow as number | undefined;
  const primaryAxisSizing = anyC.primaryAxisSizingMode as
    | "AUTO"
    | "FIXED"
    | undefined;
  const counterAxisSizing = anyC.counterAxisSizingMode as
    | "AUTO"
    | "FIXED"
    | undefined;

  const primary: "HUG" | "FIXED" | "FILL" =
    layoutGrow === 1 ? "FILL" : primaryAxisSizing === "AUTO" ? "HUG" : "FIXED";
  const counter: "HUG" | "FIXED" =
    counterAxisSizing === "AUTO" ? "HUG" : "FIXED";

  const { w, h } = sizeOf(child);

  let align: Sizing["align"] | undefined = undefined;
  try {
    align = (anyC.counterAxisAlignItems as any) || undefined;
  } catch {}

  return { primary, counter, w, h, align };
}

function getRadii(n: SceneNode): Radius | undefined {
  try {
    const anyN = n as any;
    const tl = anyN.topLeftRadius as number | undefined;
    const tr = anyN.topRightRadius as number | undefined;
    const br = anyN.bottomRightRadius as number | undefined;
    const bl = anyN.bottomLeftRadius as number | undefined;
    if ([tl, tr, br, bl].some((v) => typeof v === "number"))
      return { tl, tr, br, bl };

    if ("cornerRadius" in anyN && typeof anyN.cornerRadius === "number") {
      const r = anyN.cornerRadius as number;
      return { tl: r, tr: r, br: r, bl: r };
    }
  } catch {}
  return undefined;
}

function getShadows(n: SceneNode): Shadow[] | undefined {
  try {
    const anyN = n as any;
    const eff = anyN.effects as ReadonlyArray<Effect> | undefined;
    if (!eff) return;

    const out: Shadow[] = [];
    for (const e of eff) {
      const visible = (e as any).visible !== false;
      if (!visible) continue;
      if (e.type !== "DROP_SHADOW" && e.type !== "INNER_SHADOW") continue;

      const col = (e as any).color as RGBA;
      out.push({
        inset: e.type === "INNER_SHADOW",
        x: (e as any).offset.x,
        y: (e as any).offset.y,
        blur: (e as any).radius,
        r: col.r,
        g: col.g,
        b: col.b,
        a: typeof col.a === "number" ? col.a : 1,
      });
    }
    return out.length ? out : undefined;
  } catch {
    return;
  }
}

function getStroke(n: SceneNode): Stroke | undefined {
  try {
    const anyN = n as any;
    const weight = anyN.strokeWeight as number | undefined;
    if (!weight || weight <= 0) return undefined;

    const align = anyN.strokeAlign as
      | "INSIDE"
      | "CENTER"
      | "OUTSIDE"
      | undefined;

    const s = (anyN.strokes || []) as Paint[];
    const visible = Array.isArray(s)
      ? s.filter((pp) => (pp as any)?.visible !== false)
      : [];
    const p = visible.length ? visible[visible.length - 1] : undefined;

    if (!p || p.type !== "SOLID") return undefined;

    const opacity = (p as any).opacity as number | undefined;
    const vis = typeof opacity === "number" ? opacity > 0.001 : true;
    if (!vis) return undefined;

    const color = rgbaFromRGB((p as SolidPaint).color as RGB, opacity ?? 1);
    return { weight, align, color };
  } catch {
    return;
  }
}

function solidFromPaint(p: SolidPaint): SolidFill {
  const c = rgbaFromRGB(p.color as RGB, p.opacity ?? 1);
  return { kind: "solid", r: c.r, g: c.g, b: c.b, a: c.a };
}

function gradientFromPaint(
  p: GradientPaint
): LinearGradient | RadialGradient | NoneFill {
  try {
    const stops = (p.gradientStops || []).map((s) => {
      const col = s.color as RGBA;
      const a = typeof col.a === "number" ? col.a : 1;
      return { r: col.r, g: col.g, b: col.b, a, pos: s.position };
    });

    if (p.type === "GRADIENT_LINEAR") {
      const t = (p.gradientTransform as any) || [
        [1, 0, 0],
        [0, 1, 0],
      ];
      const dx = t[0][0],
        dy = t[1][0];
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      return { kind: "gradient", type: "LINEAR", angle, stops };
    }

    if (p.type === "GRADIENT_RADIAL") {
      const cx = (p.gradientTransform as any)?.[0]?.[2] ?? 0.5;
      const cy = (p.gradientTransform as any)?.[1]?.[2] ?? 0.5;
      return { kind: "gradient", type: "RADIAL", cx, cy, stops };
    }

    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

function safeRGBA(rgb: RGB | RGBA | undefined, fallbackA = 1) {
  if (
    !rgb ||
    typeof (rgb as any).r !== "number" ||
    typeof (rgb as any).g !== "number" ||
    typeof (rgb as any).b !== "number"
  )
    return undefined;
  const a = (rgb as any).a;
  return {
    r: (rgb as any).r,
    g: (rgb as any).g,
    b: (rgb as any).b,
    a: typeof a === "number" ? a : fallbackA,
  };
}

function isSolidVisible(p: SolidPaint | undefined): boolean {
  if (!p || p.type !== "SOLID") return false;
  if ((p as any).visible === false) return false;
  const a = typeof p.opacity === "number" ? p.opacity : 1;
  if (a <= 0.001) return false;
  const c = safeRGBA(p.color, a);
  if (!c) return false;
  return true;
}

/**
 * PATCH: export ALL visible paints, not just the last one.
 * This is critical for gradient + image background combos.
 * TEXT nodes return none (their fill is text color).
 */
function getFills(n: SceneNode): Fill[] {
  try {
    if (n.type === "TEXT") return [{ kind: "none" }];

    const anyN = n as any;
    const paints = (anyN.fills || []) as Paint[];
    if (!Array.isArray(paints) || !paints.length) return [{ kind: "none" }];

    const visible = paints.filter((pp) => (pp as any)?.visible !== false);
    if (!visible.length) return [{ kind: "none" }];

    const out: Fill[] = [];

    for (const p of visible) {
      if (p.type === "SOLID") {
        if (!isSolidVisible(p as SolidPaint)) continue;
        out.push(solidFromPaint(p as SolidPaint));
        continue;
      }

      if (p.type === "IMAGE") {
        const mode = (p as any).scaleMode as ImageFill["scaleMode"];
        const imageHash = (p as any).imageHash as string | undefined;

        out.push({
          kind: "image",
          scaleMode: mode,
          imageHash: imageHash || undefined,
        });

        continue;
      }

      if (String((p as any).type || "").startsWith("GRADIENT")) {
        const g = gradientFromPaint(p as GradientPaint);
        if (g.kind !== "none") out.push(g);
        continue;
      }
    }

    return out.length ? out : [{ kind: "none" }];
  } catch {
    return [{ kind: "none" }];
  }
}

function getOpacity(n: SceneNode): number | undefined {
  const o = (n as any).opacity;
  return typeof o === "number" ? o : undefined;
}

function getBlendMode(n: SceneNode): string | undefined {
  try {
    return (n as any).blendMode as string;
  } catch {
    return;
  }
}

function getBlur(n: SceneNode): BlurInfo | undefined {
  try {
    const anyN = n as any;
    const eff = anyN.effects as ReadonlyArray<Effect> | undefined;
    if (!eff) return;

    for (const e of eff) {
      const visible = (e as any).visible !== false;
      if (!visible) continue;
      if (e.type !== "LAYER_BLUR" && e.type !== "BACKGROUND_BLUR") continue;
      const typeStr: "LAYER" | "BACKGROUND" =
        e.type === "LAYER_BLUR" ? "LAYER" : "BACKGROUND";
      return { type: typeStr, radius: (e as any).radius as number };
    }
  } catch {}
  return undefined;
}

function sniffImageMime(bytes: Uint8Array): { mime: string; ext: string } {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // GIF: "GIF"
  if (
    bytes.length >= 3 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return { mime: "image/gif", ext: "gif" };
  }

  // WEBP: "RIFF....WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  // Fallback
  return { mime: "image/png", ext: "png" };
}

async function uploadBytesAsAsset(
  filename: string,
  mime: string,
  bytes: Uint8Array
): Promise<string | undefined> {
  try {
    const b64 = figma.base64Encode(bytes);

    const resp: any = await fetch("http://127.0.0.1:5173/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        dataUrl: `data:${mime};base64,${b64}`,
      }),
    });

    const out = (await resp.json()) as { ok?: boolean; url?: string };
    return out?.url || undefined;
  } catch {
    return undefined;
  }
}

// Cache so repeated fills don’t re-upload
const fillImageHashCache = new Map<string, string>();

async function exportFillImageByHash(
  imageHash: string
): Promise<string | undefined> {
  if (!imageHash) return undefined;
  const cached = fillImageHashCache.get(imageHash);
  if (cached) return cached;

  try {
    const img = figma.getImageByHash(imageHash);
    if (!img) return undefined; // ✅ FIX (null guard)

    const bytes = await img.getBytesAsync();
    const { mime, ext } = sniffImageMime(bytes);

    const safe = `fill_${
      imageHash.replace(/[^a-z0-9_-]+/gi, "").slice(0, 24) || "img"
    }`;
    const url = await uploadBytesAsAsset(`${safe}.${ext}`, mime, bytes);

    if (url) fillImageHashCache.set(imageHash, url);
    return url;
  } catch {
    return undefined;
  }
}

/** Upload image asset to generator for preview use */
async function exportPNG(n: SceneNode): Promise<ExportedImage | undefined> {
  try {
    const bytes: Uint8Array = await (n as any).exportAsync({ format: "PNG" });
    const b64 = figma.base64Encode(bytes);

    const safeBase =
      String((n as any).name || "img")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "img";

    // PATCH: use any-typed fetch response to avoid TS headers typing issues
    const resp: any = await fetch("http://127.0.0.1:5173/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: `${safeBase}.png`,
        dataUrl: `data:image/png;base64,${b64}`,
      }),
    });

    const out = (await resp.json()) as { ok?: boolean; url?: string };
    if (!out?.url) return;

    const { w, h } = sizeOf(n);
    return { src: out.url, w, h };
  } catch {
    return;
  }
}

/** Reactions → actions (OPEN_URL) */
function getActions(n: SceneNode): Actions | undefined {
  try {
    const anyN = n as any;
    const rs = anyN.reactions as any[] | undefined;
    if (!Array.isArray(rs) || !rs.length) return;

    for (const r of rs) {
      const a = r?.action;
      if (a?.type === "OPEN_URL" && a.url)
        return { openUrl: String(a.url), isClickable: true };
    }
    return { isClickable: true };
  } catch {
    return;
  }
}

function textPayload(n: TextNode): TextPayload {
  let family: string | undefined;
  try {
    const fn = (n as any).fontName;
    if (fn && fn !== figma.mixed) family = (fn as FontName).family;
  } catch {}

  let color: TextPayload["color"] | undefined;
  try {
    const paints = (n.fills || []) as Paint[];
    if (Array.isArray(paints) && paints.length && paints[0].type === "SOLID") {
      const p = paints[0] as SolidPaint;
      const c = rgbaFromRGB(p.color as RGB, p.opacity ?? 1);
      color = { r: c.r, g: c.g, b: c.b, a: c.a };
    }
  } catch {}

  const dec = (n as any).textDecoration as string | undefined;
  const decoration: TextPayload["decoration"] =
    dec === "UNDERLINE"
      ? "underline"
      : dec === "STRIKETHROUGH"
      ? "line-through"
      : "none";

  const italic = !!((n as any).fontName as any)?.style
    ?.toLowerCase?.()
    ?.includes?.("italic");
  const raw = n.characters || "";
  const uppercase =
    raw.length > 0 && raw.toUpperCase() === raw && /^[A-Z0-9\s\W]+$/.test(raw);

  return {
    raw,
    family,
    fontSize: (n as any).fontSize ?? undefined,
    fontWeight: (n as any).fontWeight ?? undefined,
    lineHeightPx:
      typeof (n as any).lineHeight?.value === "number"
        ? (n as any).lineHeight.value
        : undefined,
    letterSpacingPx:
      typeof (n as any).letterSpacing?.value === "number"
        ? (n as any).letterSpacing.value
        : undefined,
    align: ((n.textAlignHorizontal as string) || "LEFT").toLowerCase() as
      | "left"
      | "center"
      | "right",
    color,
    italic,
    decoration,
    uppercase,
  };
}

function isContainerNode(node: SceneNode): boolean {
  return (
    node.type === "FRAME" ||
    node.type === "GROUP" ||
    node.type === "COMPONENT" ||
    node.type === "COMPONENT_SET" ||
    node.type === "INSTANCE"
  );
}
/**
 * NEW: capture ALL descendant TextNodes under a node (used for rasterized INSTANCE labels).
 * We return them in document order as best-effort.
 */
function collectTextDescendants(node: SceneNode): TextPayload[] {
  const out: TextPayload[] = [];

  function rec(n: SceneNode) {
    if (!isNodeVisible(n)) return;

    if (n.type === "TEXT") {
      try {
        out.push(textPayload(n as TextNode));
      } catch {
        // ignore
      }
      return;
    }

    if ("children" in n) {
      const kids = (n as any as ChildrenMixin).children as readonly SceneNode[];
      for (const c of kids) rec(c);
    }
  }

  rec(node);
  return out.filter(
    (t) => typeof t?.raw === "string" && t.raw.trim().length > 0
  );
}

/**
 * Walk the Figma node tree:
 * - Skip hidden nodes
 * - Attach absolute BB (bb)
 * - Rasterize image fills + complex nodes
 * PATCH:
 * - If a CONTAINER has image fills, exportPNG but DO NOT early-return; keep children.
 * - Only early-return for non-containers (or complex types) where children aren't needed.
 * - NEW: INSTANCE nodes are rasterized but we export their descendant text as `__instanceText`.
 */
async function walk(
  node: SceneNode,
  parent?: SceneNode
): Promise<NodeBase | null> {
  if (!isNodeVisible(node)) return null;

  const { w, h } = sizeOf(node);

  const base: NodeBase = {
    id: node.id,
    name: node.name,
    type: node.type,
    w: round(w),
    h: round(h),
    bb: absBB(node),

    auto: getAutoLayout(node),
    size: parent ? childSizingInParent(parent, node) : undefined,
    r: getRadii(node),
    shadows: getShadows(node),
    stroke: getStroke(node),
    fills: getFills(node),
    opacity: getOpacity(node),
    blendMode: getBlendMode(node),
    blur: getBlur(node),
    clipsContent: (node as any).clipsContent === true,
    actions: getActions(node),
  };

  // NEW: if node has IMAGE fills, export the underlying bitmap(s) and attach fill.src
  if (Array.isArray(base.fills)) {
    for (const f of base.fills) {
      if (f.kind === "image" && f.imageHash && !f.src) {
        const url = await exportFillImageByHash(f.imageHash);
        if (url) f.src = url;
      }
    }
  }

  if (node.type === "TEXT") {
    base.text = textPayload(node as TextNode);
  }

  const hasImgFill = base.fills?.some((f) => f.kind === "image") === true;
  const complex = shouldRasterizeNode(node);

  // IMPORTANT: INSTANCE nodes must keep their label text even if rasterized.
  if (node.type === "INSTANCE") {
    // Rasterize for pixel-fidelity background
    const img = await exportPNG(node);
    if (img) base.img = img;

    // Capture label(s) from descendants (text inside the instance)
    const runs = collectTextDescendants(node);
    if (runs.length) base.__instanceText = runs;

    // Do NOT traverse instance internals (keeps AST small & avoids duplicating vectors)
    return base;
  }

  // Non-instance raster rules
  if (hasImgFill || complex) {
    const img = await exportPNG(node);
    if (img) base.img = img;

    const container = isContainerNode(node);
    const canHaveChildren = "children" in (node as any);
    const hasKids =
      canHaveChildren &&
      Array.isArray((node as any as ChildrenMixin).children) &&
      (node as any as ChildrenMixin).children.length > 0;

    // Early return only for non-containers (instances are handled above)
    if (!container) return base;
  }

  if ("children" in node) {
    const kids = (node as any as ChildrenMixin)
      .children as readonly SceneNode[];
    const outKids: NodeBase[] = [];
    for (const c of kids) {
      const child = await walk(c, node);
      if (child) outKids.push(child);
    }
    if (outKids.length) base.children = outKids;
  }

  return base;
}

function findChildByName(
  root: NodeBase,
  nameLower: string
): NodeBase | undefined {
  if (root.name.toLowerCase() === nameLower) return root;
  for (const c of root.children || []) {
    const f = findChildByName(c, nameLower);
    if (f) return f;
  }
  return undefined;
}

/** ===== UI messaging ===== */
figma.ui.onmessage = async (msg: {
  type: "EXPORT_SELECTION" | "EXPORT_PHASE1" | "CLOSE";
  slug?: string;
}) => {
  if (msg.type === "EXPORT_SELECTION" || msg.type === "EXPORT_PHASE1") {
    try {
      const sel = figma.currentPage.selection;
      if (sel.length !== 1 || sel[0].type !== "FRAME") {
        figma.ui.postMessage({
          type: "ERROR",
          message: "Select a single Frame (Auto layout recommended).",
        });
        return;
      }

      const frame = sel[0] as FrameNode;
      const slug = (msg.slug || frame.name || "section")
        .toLowerCase()
        .replace(/\s+/g, "_");

      const treeMaybe = await walk(frame);
      if (!treeMaybe) {
        figma.ui.postMessage({
          type: "ERROR",
          message: "Selected frame is hidden or exported to an empty tree.",
        });
        return;
      }
      const tree = treeMaybe;

      // NEW: Export a reference overlay image for pixel-compare in preview
      const overlayImg = await exportPNG(frame);

      // Optional semantic slots (by layer names)
      const headingNode = findChildByName(tree, "elem: heading");
      const subcopyNode = findChildByName(tree, "elem: subcopy");
      const ctaNode = findChildByName(tree, "elem: cta_primary");
      const imageNode = findChildByName(tree, "elem: image_main");

      const ast: AST = {
        slug,
        type: "flexi_block",
        frame: { w: tree.w, h: tree.h },
        tree,
        slots: {
          heading: headingNode?.id,
          subcopy: subcopyNode?.id,
          cta_primary: ctaNode?.id,
          image_main: imageNode?.id,
        },
        meta: {
          schema: msg.type === "EXPORT_PHASE1" ? "raw-figma-ast" : "figma-ast",
          version: 1,
          exportedAt: new Date().toISOString(),
          figma: {
            pageName: figma.currentPage?.name,
            frameName: frame.name,
          },
          overlay: overlayImg
            ? { src: overlayImg.src, w: overlayImg.w, h: overlayImg.h }
            : undefined,
        },
      };

      if (msg.type === "EXPORT_PHASE1")
        figma.ui.postMessage({ type: "PHASE1_READY", ast } as any);
      else figma.ui.postMessage({ type: "AST_READY", ast } as any);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      figma.ui.postMessage({ type: "ERROR", message });
    }
  }

  if (msg.type === "CLOSE") figma.closePlugin();
};
