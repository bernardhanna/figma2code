"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
figma.showUI(__html__, { width: 440, height: 420 });
/** ===== Helpers ===== */
const round = (n) => Math.round(n * 1000) / 1000;
function rgbaFromRGB(rgb, alpha) {
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
function decodeUtf8(bytes) {
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
        for (let i = 0; i < bytes.length; i++)
            s += String.fromCharCode(bytes[i]);
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
function sizeOf(n) {
    const anyN = n;
    const w = typeof anyN.width === "number" ? anyN.width : 0;
    const h = typeof anyN.height === "number" ? anyN.height : 0;
    return { w: round(w), h: round(h) };
}
function absBB(n) {
    try {
        const bb = n.absoluteBoundingBox;
        if (!bb)
            return undefined;
        return {
            x: round(bb.x),
            y: round(bb.y),
            w: round(bb.width),
            h: round(bb.height),
        };
    }
    catch (_a) {
        return undefined;
    }
}
function isNodeVisible(n) {
    try {
        if (n.visible === false)
            return false;
        const o = n.opacity;
        if (typeof o === "number" && o <= 0.001)
            return false;
        return true;
    }
    catch (_a) {
        return true;
    }
}
function letterSpacingToPx(textNode) {
    const ls = textNode.letterSpacing;
    if (!ls || typeof ls.value !== "number")
        return undefined;
    const v = ls.value;
    const unit = String(ls.unit || "PIXELS").toUpperCase();
    // PIXELS: already px
    if (unit === "PIXELS")
        return v;
    // PERCENT: convert percent-of-font-size -> px
    if (unit === "PERCENT") {
        const fs = textNode.fontSize;
        if (typeof fs === "number")
            return (fs * v) / 100;
    }
    // fallback
    return v;
}
/**
 * Pixel-fidelity: rasterize these types even when they don't have image fills,
 * because converting vectors/instances into Tailwind boxes is not reliable.
 */
function shouldRasterizeNode(node) {
    const t = node.type;
    return (t === "INSTANCE" ||
        t === "VECTOR" ||
        t === "BOOLEAN_OPERATION" ||
        t === "STAR" ||
        t === "LINE" ||
        t === "ELLIPSE" ||
        t === "POLYGON");
}
function getAutoLayout(n) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!("layoutMode" in n))
        return;
    const anyN = n;
    const mode = anyN.layoutMode;
    if (!mode)
        return { layout: "NONE" };
    return {
        layout: mode,
        itemSpacing: (_a = anyN.itemSpacing) !== null && _a !== void 0 ? _a : 0,
        padT: (_b = anyN.paddingTop) !== null && _b !== void 0 ? _b : 0,
        padR: (_c = anyN.paddingRight) !== null && _c !== void 0 ? _c : 0,
        padB: (_d = anyN.paddingBottom) !== null && _d !== void 0 ? _d : 0,
        padL: (_e = anyN.paddingLeft) !== null && _e !== void 0 ? _e : 0,
        primaryAlign: (_f = anyN.primaryAxisAlignItems) !== null && _f !== void 0 ? _f : "MIN",
        counterAlign: (_g = anyN.counterAxisAlignItems) !== null && _g !== void 0 ? _g : "MIN",
        primarySizing: anyN.primaryAxisSizingMode === "AUTO" ? "HUG" : "FIXED",
        counterSizing: anyN.counterAxisSizingMode === "AUTO" ? "HUG" : "FIXED",
    };
}
function childSizingInParent(parent, child) {
    if (!("layoutMode" in parent))
        return;
    const anyP = parent;
    const mode = anyP.layoutMode;
    if (!mode || mode === "NONE")
        return;
    const anyC = child;
    const layoutGrow = anyC.layoutGrow;
    const primaryAxisSizing = anyC.primaryAxisSizingMode;
    const counterAxisSizing = anyC.counterAxisSizingMode;
    const primary = layoutGrow === 1 ? "FILL" : primaryAxisSizing === "AUTO" ? "HUG" : "FIXED";
    const counter = counterAxisSizing === "AUTO" ? "HUG" : "FIXED";
    const { w, h } = sizeOf(child);
    let align = undefined;
    try {
        align = anyC.counterAxisAlignItems || undefined;
    }
    catch (_a) { }
    return { primary, counter, w, h, align };
}
function getRadii(n) {
    try {
        const anyN = n;
        const tl = anyN.topLeftRadius;
        const tr = anyN.topRightRadius;
        const br = anyN.bottomRightRadius;
        const bl = anyN.bottomLeftRadius;
        if ([tl, tr, br, bl].some((v) => typeof v === "number"))
            return { tl, tr, br, bl };
        if ("cornerRadius" in anyN && typeof anyN.cornerRadius === "number") {
            const r = anyN.cornerRadius;
            return { tl: r, tr: r, br: r, bl: r };
        }
    }
    catch (_a) { }
    return undefined;
}
function getShadows(n) {
    try {
        const anyN = n;
        const eff = anyN.effects;
        if (!eff)
            return;
        const out = [];
        for (const e of eff) {
            const visible = e.visible !== false;
            if (!visible)
                continue;
            if (e.type !== "DROP_SHADOW" && e.type !== "INNER_SHADOW")
                continue;
            const col = e.color;
            out.push({
                inset: e.type === "INNER_SHADOW",
                x: e.offset.x,
                y: e.offset.y,
                blur: e.radius,
                r: col.r,
                g: col.g,
                b: col.b,
                a: typeof col.a === "number" ? col.a : 1,
            });
        }
        return out.length ? out : undefined;
    }
    catch (_a) {
        return;
    }
}
function getStroke(n) {
    try {
        const anyN = n;
        const weight = anyN.strokeWeight;
        if (!weight || weight <= 0)
            return undefined;
        const align = anyN.strokeAlign;
        const s = (anyN.strokes || []);
        const visible = Array.isArray(s)
            ? s.filter((pp) => (pp === null || pp === void 0 ? void 0 : pp.visible) !== false)
            : [];
        const p = visible.length ? visible[visible.length - 1] : undefined;
        if (!p || p.type !== "SOLID")
            return undefined;
        const opacity = p.opacity;
        const vis = typeof opacity === "number" ? opacity > 0.001 : true;
        if (!vis)
            return undefined;
        const color = rgbaFromRGB(p.color, opacity !== null && opacity !== void 0 ? opacity : 1);
        return { weight, align, color };
    }
    catch (_a) {
        return;
    }
}
function solidFromPaint(p) {
    var _a;
    const c = rgbaFromRGB(p.color, (_a = p.opacity) !== null && _a !== void 0 ? _a : 1);
    return { kind: "solid", r: c.r, g: c.g, b: c.b, a: c.a };
}
function gradientFromPaint(p) {
    var _a, _b, _c, _d, _e, _f;
    try {
        const stops = (p.gradientStops || []).map((s) => {
            const col = s.color;
            const a = typeof col.a === "number" ? col.a : 1;
            return { r: col.r, g: col.g, b: col.b, a, pos: s.position };
        });
        if (p.type === "GRADIENT_LINEAR") {
            const t = p.gradientTransform || [
                [1, 0, 0],
                [0, 1, 0],
            ];
            const dx = t[0][0], dy = t[1][0];
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return { kind: "gradient", type: "LINEAR", angle, stops };
        }
        if (p.type === "GRADIENT_RADIAL") {
            const cx = (_c = (_b = (_a = p.gradientTransform) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b[2]) !== null && _c !== void 0 ? _c : 0.5;
            const cy = (_f = (_e = (_d = p.gradientTransform) === null || _d === void 0 ? void 0 : _d[1]) === null || _e === void 0 ? void 0 : _e[2]) !== null && _f !== void 0 ? _f : 0.5;
            return { kind: "gradient", type: "RADIAL", cx, cy, stops };
        }
        return { kind: "none" };
    }
    catch (_g) {
        return { kind: "none" };
    }
}
function safeRGBA(rgb, fallbackA = 1) {
    if (!rgb ||
        typeof rgb.r !== "number" ||
        typeof rgb.g !== "number" ||
        typeof rgb.b !== "number")
        return undefined;
    const a = rgb.a;
    return {
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        a: typeof a === "number" ? a : fallbackA,
    };
}
function isSolidVisible(p) {
    if (!p || p.type !== "SOLID")
        return false;
    if (p.visible === false)
        return false;
    const a = typeof p.opacity === "number" ? p.opacity : 1;
    if (a <= 0.001)
        return false;
    const c = safeRGBA(p.color, a);
    if (!c)
        return false;
    return true;
}
/**
 * PATCH: export ALL visible paints, not just the last one.
 * This is critical for gradient + image background combos.
 * TEXT nodes return none (their fill is text color).
 */
function getFills(n) {
    try {
        if (n.type === "TEXT")
            return [{ kind: "none" }];
        const anyN = n;
        const paints = (anyN.fills || []);
        if (!Array.isArray(paints) || !paints.length)
            return [{ kind: "none" }];
        const visible = paints.filter((pp) => (pp === null || pp === void 0 ? void 0 : pp.visible) !== false);
        if (!visible.length)
            return [{ kind: "none" }];
        const out = [];
        for (const p of visible) {
            if (p.type === "SOLID") {
                if (!isSolidVisible(p))
                    continue;
                out.push(solidFromPaint(p));
                continue;
            }
            if (p.type === "IMAGE") {
                const mode = p.scaleMode;
                const imageHash = p.imageHash;
                out.push({
                    kind: "image",
                    scaleMode: mode,
                    imageHash: imageHash || undefined,
                });
                continue;
            }
            if (String(p.type || "").startsWith("GRADIENT")) {
                const g = gradientFromPaint(p);
                if (g.kind !== "none")
                    out.push(g);
                continue;
            }
        }
        return out.length ? out : [{ kind: "none" }];
    }
    catch (_a) {
        return [{ kind: "none" }];
    }
}
function getOpacity(n) {
    const o = n.opacity;
    return typeof o === "number" ? o : undefined;
}
function getBlendMode(n) {
    try {
        return n.blendMode;
    }
    catch (_a) {
        return;
    }
}
function getBlur(n) {
    try {
        const anyN = n;
        const eff = anyN.effects;
        if (!eff)
            return;
        for (const e of eff) {
            const visible = e.visible !== false;
            if (!visible)
                continue;
            if (e.type !== "LAYER_BLUR" && e.type !== "BACKGROUND_BLUR")
                continue;
            const typeStr = e.type === "LAYER_BLUR" ? "LAYER" : "BACKGROUND";
            return { type: typeStr, radius: e.radius };
        }
    }
    catch (_a) { }
    return undefined;
}
function sniffImageMime(bytes) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a) {
        return { mime: "image/png", ext: "png" };
    }
    // JPEG: FF D8 FF
    if (bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) {
        return { mime: "image/jpeg", ext: "jpg" };
    }
    // GIF: "GIF"
    if (bytes.length >= 3 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46) {
        return { mime: "image/gif", ext: "gif" };
    }
    // WEBP: "RIFF....WEBP"
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50) {
        return { mime: "image/webp", ext: "webp" };
    }
    // Fallback
    return { mime: "image/png", ext: "png" };
}
function uploadBytesAsAsset(filename, mime, bytes) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const b64 = figma.base64Encode(bytes);
            const resp = yield fetch("http://127.0.0.1:5173/api/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename,
                    dataUrl: `data:${mime};base64,${b64}`,
                }),
            });
            const out = (yield resp.json());
            return (out === null || out === void 0 ? void 0 : out.url) || undefined;
        }
        catch (_a) {
            return undefined;
        }
    });
}
// Cache so repeated fills don’t re-upload
const fillImageHashCache = new Map();
function exportFillImageByHash(imageHash) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!imageHash)
            return undefined;
        const cached = fillImageHashCache.get(imageHash);
        if (cached)
            return cached;
        try {
            const img = figma.getImageByHash(imageHash);
            if (!img)
                return undefined; // ✅ FIX (null guard)
            const bytes = yield img.getBytesAsync();
            const { mime, ext } = sniffImageMime(bytes);
            const safe = `fill_${imageHash.replace(/[^a-z0-9_-]+/gi, "").slice(0, 24) || "img"}`;
            const url = yield uploadBytesAsAsset(`${safe}.${ext}`, mime, bytes);
            if (url)
                fillImageHashCache.set(imageHash, url);
            return url;
        }
        catch (_a) {
            return undefined;
        }
    });
}
/** Upload image asset to generator for preview use */
function exportPNG(n) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const bytes = yield n.exportAsync({ format: "PNG" });
            const b64 = figma.base64Encode(bytes);
            const safeBase = String(n.name || "img")
                .toLowerCase()
                .replace(/[^a-z0-9._-]+/g, "_")
                .replace(/^_+|_+$/g, "") || "img";
            // PATCH: use any-typed fetch response to avoid TS headers typing issues
            const resp = yield fetch("http://127.0.0.1:5173/api/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: `${safeBase}.png`,
                    dataUrl: `data:image/png;base64,${b64}`,
                }),
            });
            const out = (yield resp.json());
            if (!(out === null || out === void 0 ? void 0 : out.url))
                return;
            const { w, h } = sizeOf(n);
            return { src: out.url, w, h };
        }
        catch (_a) {
            return;
        }
    });
}
/** Reactions → actions (OPEN_URL) */
function getActions(n) {
    try {
        const anyN = n;
        const rs = anyN.reactions;
        if (!Array.isArray(rs) || !rs.length)
            return;
        for (const r of rs) {
            const a = r === null || r === void 0 ? void 0 : r.action;
            if ((a === null || a === void 0 ? void 0 : a.type) === "OPEN_URL" && a.url)
                return { openUrl: String(a.url), isClickable: true };
        }
        return { isClickable: true };
    }
    catch (_a) {
        return;
    }
}
function textPayload(n) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    let family;
    try {
        const fn = n.fontName;
        if (fn && fn !== figma.mixed)
            family = fn.family;
    }
    catch (_l) { }
    let color;
    try {
        const paints = (n.fills || []);
        if (Array.isArray(paints) && paints.length && paints[0].type === "SOLID") {
            const p = paints[0];
            const c = rgbaFromRGB(p.color, (_a = p.opacity) !== null && _a !== void 0 ? _a : 1);
            color = { r: c.r, g: c.g, b: c.b, a: c.a };
        }
    }
    catch (_m) { }
    const dec = n.textDecoration;
    const decoration = dec === "UNDERLINE"
        ? "underline"
        : dec === "STRIKETHROUGH"
            ? "line-through"
            : "none";
    const italic = !!((_f = (_e = (_d = (_c = (_b = n.fontName) === null || _b === void 0 ? void 0 : _b.style) === null || _c === void 0 ? void 0 : _c.toLowerCase) === null || _d === void 0 ? void 0 : _d.call(_c)) === null || _e === void 0 ? void 0 : _e.includes) === null || _f === void 0 ? void 0 : _f.call(_e, "italic"));
    const raw = n.characters || "";
    const uppercase = raw.length > 0 && raw.toUpperCase() === raw && /^[A-Z0-9\s\W]+$/.test(raw);
    return {
        raw,
        family,
        fontSize: (_g = n.fontSize) !== null && _g !== void 0 ? _g : undefined,
        fontWeight: (_h = n.fontWeight) !== null && _h !== void 0 ? _h : undefined,
        lineHeightPx: typeof ((_j = n.lineHeight) === null || _j === void 0 ? void 0 : _j.value) === "number"
            ? n.lineHeight.value
            : undefined,
        letterSpacingPx: typeof ((_k = n.letterSpacing) === null || _k === void 0 ? void 0 : _k.value) === "number"
            ? n.letterSpacing.value
            : undefined,
        align: (n.textAlignHorizontal || "LEFT").toLowerCase(),
        color,
        italic,
        decoration,
        uppercase,
    };
}
function isContainerNode(node) {
    return (node.type === "FRAME" ||
        node.type === "GROUP" ||
        node.type === "COMPONENT" ||
        node.type === "COMPONENT_SET" ||
        node.type === "INSTANCE");
}
/**
 * Heuristic: is this node an "interactive-looking" control where we care about states?
 * We keep this narrow (buttons/links/cards/CTAs) to keep export size small.
 */
function isInteractiveLooking(node, actions) {
    const name = String(node.name || "").toLowerCase();
    if (name.includes("button") ||
        name.includes("btn") ||
        name.includes("cta") ||
        name.includes("link") ||
        name.includes("card")) {
        return true;
    }
    if ((actions === null || actions === void 0 ? void 0 : actions.isClickable) || (actions === null || actions === void 0 ? void 0 : actions.openUrl))
        return true;
    return false;
}
/**
 * Lightweight walker used for state snapshots:
 * - No PNG export (keeps payload small)
 * - Traverses INSTANCE internals so we can diff backgrounds/text/etc when available
 */
function walkForState(node) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isNodeVisible(node))
            return null;
        const { w, h } = sizeOf(node);
        const base = {
            id: node.id,
            name: node.name,
            type: node.type,
            w: round(w),
            h: round(h),
            bb: absBB(node),
            auto: getAutoLayout(node),
            size: undefined,
            r: getRadii(node),
            shadows: getShadows(node),
            stroke: getStroke(node),
            fills: getFills(node),
            opacity: getOpacity(node),
            blendMode: getBlendMode(node),
            blur: getBlur(node),
            clipsContent: node.clipsContent === true,
            actions: getActions(node),
        };
        if (node.type === "TEXT") {
            base.text = textPayload(node);
        }
        if ("children" in node) {
            const kids = node
                .children;
            const outKids = [];
            for (const c of kids) {
                const child = yield walkForState(c);
                if (child)
                    outKids.push(child);
            }
            if (outKids.length)
                base.children = outKids;
        }
        return base;
    });
}
function isDefaultVariantValue(raw) {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (!v)
        return false;
    return (v === "default" ||
        v === "base" ||
        v === "rest" ||
        v === "normal" ||
        v === "primary");
}
function mapVariantValueToPseudo(raw) {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (!v)
        return "";
    if (v === "hover" || v === "on hover" || v.includes("hover"))
        return "hover";
    if (v === "pressed" ||
        v === "press" ||
        v === "active" ||
        v === "down" ||
        v.includes("pressed") ||
        v.includes("press") ||
        v.includes("active"))
        return "active";
    if (v === "focus" ||
        v === "focused" ||
        v === "focus visible" ||
        v === "focus-visible" ||
        v.includes("focus")) {
        return "focus";
    }
    if (v === "disabled" || v === "inactive" || v.includes("disabled"))
        return "disabled";
    return "";
}
/**
 * Find a component in the set that matches the given variant properties.
 * Returns the first matching component, or null if none found.
 */
function findComponentByVariantProperties(set, targetProps) {
    const children = (set.children || []);
    for (const comp of children) {
        const vp = (comp.variantProperties || {});
        let matches = true;
        for (const [axisName, targetValue] of Object.entries(targetProps)) {
            if (vp[axisName] !== targetValue) {
                matches = false;
                break;
            }
        }
        if (matches)
            return comp;
    }
    return null;
}
/**
 * Inspect a component set and infer which axis encodes interaction state.
 */
function inferStateAxisInfo(instance) {
    var _a;
    const main = instance.mainComponent;
    const set = ((main === null || main === void 0 ? void 0 : main.parent) || null);
    if (!main || !set || set.type !== "COMPONENT_SET")
        return null;
    const children = (set.children || []);
    if (!children.length)
        return null;
    const axisScore = {};
    for (const comp of children) {
        const vp = (comp.variantProperties || {});
        for (const [axisNameRaw, valueRaw] of Object.entries(vp)) {
            const axisName = String(axisNameRaw || "");
            const value = String(valueRaw || "");
            if (!axisName || !value)
                continue;
            const pseudo = mapVariantValueToPseudo(value);
            if (!pseudo)
                continue;
            const key = axisName;
            if (!axisScore[key]) {
                axisScore[key] = {
                    axisName,
                    hitCount: 0,
                    values: {},
                };
            }
            axisScore[key].hitCount++;
            axisScore[key].values[value] = { component: comp, value };
        }
    }
    const candidates = Object.values(axisScore).sort((a, b) => b.hitCount - a.hitCount);
    if (!candidates.length)
        return null;
    const best = candidates[0];
    // Get current variant properties from the instance
    // Priority: instance.variantProperties (instance overrides) > mainComponent.variantProperties
    const instanceVp = (instance.variantProperties || {});
    const mainVp = (((_a = instance.mainComponent) === null || _a === void 0 ? void 0 : _a.variantProperties) ||
        {});
    const currentVp = Object.assign(Object.assign({}, mainVp), instanceVp); // Instance overrides component
    // Store all current variant properties (for preserving non-state axes like color)
    const allCurrentProps = Object.assign({}, currentVp);
    const currentValue = currentVp[best.axisName] || null;
    // Prefer an explicit "Default"/"Base" style variant as the baseline, regardless
    // of what the instance is currently set to in the design.
    // But preserve other axes (like color) from the current instance.
    let defaultComponent = instance.mainComponent || null;
    let defaultValue = currentValue;
    // Try to find a "Default" variant that also matches current non-state properties
    for (const { component, value } of Object.values(best.values)) {
        if (isDefaultVariantValue(value)) {
            const compVp = (component.variantProperties || {});
            // Check if this component matches current values for all OTHER axes
            let matchesOtherAxes = true;
            for (const [axisName, currentVal] of Object.entries(allCurrentProps)) {
                if (axisName === best.axisName)
                    continue; // Skip state axis
                if (compVp[axisName] !== currentVal) {
                    matchesOtherAxes = false;
                    break;
                }
            }
            if (matchesOtherAxes) {
                defaultComponent = component;
                defaultValue = value;
                break;
            }
        }
    }
    // If we didn't find a matching default, try to find any component that matches
    // current non-state properties with a default state value
    if (!defaultComponent || defaultComponent === main) {
        const targetProps = Object.assign({}, allCurrentProps);
        // Try different default state values
        for (const defaultStateValue of [
            "Default",
            "Base",
            "Rest",
            "Normal",
            "Primary",
        ]) {
            targetProps[best.axisName] = defaultStateValue;
            const found = findComponentByVariantProperties(set, targetProps);
            if (found) {
                defaultComponent = found;
                defaultValue = defaultStateValue;
                break;
            }
        }
        // If still not found, use the current main component
        if (!defaultComponent) {
            defaultComponent = main;
            defaultValue = currentValue;
        }
    }
    const valuesByPseudo = {
        default: { component: defaultComponent, value: defaultValue },
    };
    // For each state (hover, active, etc.), find components that match
    // the current values for OTHER axes (like color)
    for (const { component, value } of Object.values(best.values)) {
        const pseudo = mapVariantValueToPseudo(value);
        if (!pseudo)
            continue;
        if (!valuesByPseudo[pseudo]) {
            // Check if this component matches current values for non-state axes
            const compVp = (component.variantProperties || {});
            let matchesOtherAxes = true;
            for (const [axisName, currentVal] of Object.entries(allCurrentProps)) {
                if (axisName === best.axisName)
                    continue; // Skip state axis
                if (compVp[axisName] !== currentVal) {
                    matchesOtherAxes = false;
                    break;
                }
            }
            // Only use this component if it matches current non-state properties
            if (matchesOtherAxes) {
                valuesByPseudo[pseudo] = { component, value };
            }
        }
    }
    // If we didn't find matching components for some states, try to find them
    // by searching the component set with preserved non-state properties
    const entries = [
        "hover",
        "active",
        "focus",
        "disabled",
    ];
    for (const pseudo of entries) {
        if (valuesByPseudo[pseudo])
            continue; // Already found
        // Try to find a component with this state that matches current non-state props
        const targetProps = Object.assign({}, allCurrentProps);
        // Map pseudo to possible variant values
        const stateValues = pseudo === "hover"
            ? ["Hover", "On Hover"]
            : pseudo === "active"
                ? ["Pressed", "Press", "Active", "Down"]
                : pseudo === "focus"
                    ? ["Focus", "Focused", "Focus Visible"]
                    : ["Disabled", "Inactive"];
        for (const stateValue of stateValues) {
            targetProps[best.axisName] = stateValue;
            const found = findComponentByVariantProperties(set, targetProps);
            if (found) {
                const foundVp = (found.variantProperties || {});
                valuesByPseudo[pseudo] = {
                    component: found,
                    value: foundVp[best.axisName] || stateValue,
                };
                break;
            }
        }
    }
    return { axisName: best.axisName, valuesByPseudo };
}
/**
 * Temporarily swap the instance's main component to another variant, run `fn`, then restore.
 */
function withSwappedComponent(instance, target, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        const anyInstance = instance;
        const swap = typeof anyInstance.swapComponent === "function"
            ? anyInstance.swapComponent.bind(anyInstance)
            : null;
        const original = (anyInstance.mainComponent || null);
        if (!swap || !target || target === original) {
            return yield fn();
        }
        swap(target);
        try {
            return yield fn();
        }
        finally {
            try {
                if (original)
                    swap(original);
            }
            catch (_a) {
                // ignore restore failures
            }
        }
    });
}
/**
 * Build __states snapshots for an INSTANCE whose component set encodes interaction states.
 */
function exportInstanceStates(instance) {
    return __awaiter(this, void 0, void 0, function* () {
        const info = inferStateAxisInfo(instance);
        if (!info)
            return undefined;
        const states = {};
        // Default snapshot (preferred: explicit "Default"/"Base" variant on the axis).
        const def = yield withSwappedComponent(instance, info.valuesByPseudo.default.component, () => walkForState(instance));
        if (!def)
            return undefined;
        states.default = def;
        const entries = [
            ["hover", "hover"],
            ["active", "active"],
            ["focus", "focus"],
            ["disabled", "disabled"],
        ];
        for (const [slotKey, pseudo] of entries) {
            const rec = info.valuesByPseudo[slotKey];
            if (!rec || !rec.component)
                continue;
            const snap = yield withSwappedComponent(instance, rec.component, () => walkForState(instance));
            if (snap) {
                states[pseudo] = snap;
            }
        }
        return states;
    });
}
/**
 * NEW: capture ALL descendant TextNodes under a node (used for rasterized INSTANCE labels).
 * We return them in document order as best-effort.
 */
function collectTextDescendants(node) {
    const out = [];
    function rec(n) {
        if (!isNodeVisible(n))
            return;
        if (n.type === "TEXT") {
            try {
                out.push(textPayload(n));
            }
            catch (_a) {
                // ignore
            }
            return;
        }
        if ("children" in n) {
            const kids = n.children;
            for (const c of kids)
                rec(c);
        }
    }
    rec(node);
    return out.filter((t) => typeof (t === null || t === void 0 ? void 0 : t.raw) === "string" && t.raw.trim().length > 0);
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
function walk(node, parent) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!isNodeVisible(node))
            return null;
        const { w, h } = sizeOf(node);
        const base = {
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
            clipsContent: node.clipsContent === true,
            actions: getActions(node),
        };
        // NEW: if node has IMAGE fills, export the underlying bitmap(s) and attach fill.src
        if (Array.isArray(base.fills)) {
            for (const f of base.fills) {
                if (f.kind === "image" && f.imageHash && !f.src) {
                    const url = yield exportFillImageByHash(f.imageHash);
                    if (url)
                        f.src = url;
                }
            }
        }
        if (node.type === "TEXT") {
            base.text = textPayload(node);
        }
        const hasImgFill = ((_a = base.fills) === null || _a === void 0 ? void 0 : _a.some((f) => f.kind === "image")) === true;
        const complex = shouldRasterizeNode(node);
        // IMPORTANT: INSTANCE nodes must keep their label text even if rasterized.
        if (node.type === "INSTANCE") {
            // Rasterize for pixel-fidelity background
            const img = yield exportPNG(node);
            if (img)
                base.img = img;
            // Capture label(s) from descendants (text inside the instance)
            const runs = collectTextDescendants(node);
            if (runs.length)
                base.__instanceText = runs;
            // Best-effort interactive state snapshots (hover/active/focus/disabled) based on component variants.
            try {
                const states = yield exportInstanceStates(node);
                if (states && states.default) {
                    base.__states = states;
                    // Align the exported INSTANCE's own visual decoration with the "default"
                    // state snapshot so preview starts from the default design, even if the
                    // Figma instance is currently set to Hover/Pressed/etc.
                    const def = states.default;
                    if (def) {
                        if (Array.isArray(def.fills))
                            base.fills = def.fills;
                        if (def.stroke)
                            base.stroke = def.stroke;
                        if (Array.isArray(def.shadows))
                            base.shadows = def.shadows;
                        if (typeof def.opacity === "number")
                            base.opacity = def.opacity;
                        if (def.blendMode)
                            base.blendMode = def.blendMode;
                        if (def.blur)
                            base.blur = def.blur;
                        if (def.r)
                            base.r = def.r;
                    }
                }
            }
            catch (_b) {
                // state export is best-effort only; ignore failures
            }
            // Do NOT traverse instance internals (keeps AST small & avoids duplicating vectors)
            return base;
        }
        // Non-instance raster rules
        if (hasImgFill || complex) {
            const img = yield exportPNG(node);
            if (img)
                base.img = img;
            const container = isContainerNode(node);
            const canHaveChildren = "children" in node;
            const hasKids = canHaveChildren &&
                Array.isArray(node.children) &&
                node.children.length > 0;
            // Early return only for non-containers (instances are handled above)
            if (!container)
                return base;
        }
        if ("children" in node) {
            const kids = node
                .children;
            const outKids = [];
            for (const c of kids) {
                const child = yield walk(c, node);
                if (child)
                    outKids.push(child);
            }
            if (outKids.length)
                base.children = outKids;
        }
        return base;
    });
}
function findChildByName(root, nameLower) {
    if (root.name.toLowerCase() === nameLower)
        return root;
    for (const c of root.children || []) {
        const f = findChildByName(c, nameLower);
        if (f)
            return f;
    }
    return undefined;
}
/** ===== UI messaging ===== */
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
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
            const frame = sel[0];
            const slug = (msg.slug || frame.name || "section")
                .toLowerCase()
                .replace(/\s+/g, "_");
            const treeMaybe = yield walk(frame);
            if (!treeMaybe) {
                figma.ui.postMessage({
                    type: "ERROR",
                    message: "Selected frame is hidden or exported to an empty tree.",
                });
                return;
            }
            const tree = treeMaybe;
            // NEW: Export a reference overlay image for pixel-compare in preview
            const overlayImg = yield exportPNG(frame);
            // Optional semantic slots (by layer names)
            const headingNode = findChildByName(tree, "elem: heading");
            const subcopyNode = findChildByName(tree, "elem: subcopy");
            const ctaNode = findChildByName(tree, "elem: cta_primary");
            const imageNode = findChildByName(tree, "elem: image_main");
            const ast = {
                slug,
                type: "flexi_block",
                frame: { w: tree.w, h: tree.h },
                tree,
                slots: {
                    heading: headingNode === null || headingNode === void 0 ? void 0 : headingNode.id,
                    subcopy: subcopyNode === null || subcopyNode === void 0 ? void 0 : subcopyNode.id,
                    cta_primary: ctaNode === null || ctaNode === void 0 ? void 0 : ctaNode.id,
                    image_main: imageNode === null || imageNode === void 0 ? void 0 : imageNode.id,
                },
                meta: {
                    schema: msg.type === "EXPORT_PHASE1" ? "raw-figma-ast" : "figma-ast",
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    figma: {
                        pageName: (_a = figma.currentPage) === null || _a === void 0 ? void 0 : _a.name,
                        frameName: frame.name,
                    },
                    overlay: overlayImg
                        ? { src: overlayImg.src, w: overlayImg.w, h: overlayImg.h }
                        : undefined,
                },
            };
            if (msg.type === "EXPORT_PHASE1")
                figma.ui.postMessage({ type: "PHASE1_READY", ast });
            else
                figma.ui.postMessage({ type: "AST_READY", ast });
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            figma.ui.postMessage({ type: "ERROR", message });
        }
    }
    if (msg.type === "CLOSE")
        figma.closePlugin();
});
