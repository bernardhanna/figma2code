const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  removeAttr,
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "style/inline/stripRedundantInlineStyles";

const normalizeToken = (token) => String(token || "").split(":").pop();
const trim = (v) => String(v || "").trim();

const parseStyle = (style) => {
  const map = new Map();
  String(style || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [key, ...rest] = entry.split(":");
      if (!key) return;
      const value = rest.join(":").trim();
      map.set(key.trim().toLowerCase(), value);
    });
  return map;
};

const serializeStyle = (map) => {
  const entries = [];
  map.forEach((value, key) => {
    if (value != null && String(value).trim() !== "") {
      entries.push(`${key}: ${value}`);
    }
  });
  return entries.join("; ");
};

const parseRgba = (value) => {
  const raw = trim(value);
  const rgba = raw.match(/^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
  if (rgba) {
    const r = Number(rgba[1]);
    const g = Number(rgba[2]);
    const b = Number(rgba[3]);
    const a = Number(rgba[4]);
    if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
  }
  const rgb = raw.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    if ([r, g, b].every(Number.isFinite)) return { r, g, b, a: 1 };
  }
  return null;
};

const colorToHexClass = (rgba) => {
  if (!rgba) return "";
  if (Math.abs(Number(rgba.a) - 1) > 0.0001) return "";
  const toHex = (n) => {
    const clamped = Math.max(0, Math.min(255, Math.round(Number(n))));
    return clamped.toString(16).padStart(2, "0");
  };
  return `bg-[#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}]`;
};

const parseDegenerateGradientColor = (value) => {
  const raw = trim(value);
  const m = raw.match(
    /^linear-gradient\(\s*(rgba?\([^)]+\)|#[0-9a-f]{3,8})\s*,\s*(rgba?\([^)]+\)|#[0-9a-f]{3,8})\s*\)$/i
  );
  if (!m) return null;
  const c1 = parseRgba(m[1]);
  const c2 = parseRgba(m[2]);
  if (!c1 || !c2) return null;
  const same =
    Math.abs(c1.r - c2.r) < 0.001 &&
    Math.abs(c1.g - c2.g) < 0.001 &&
    Math.abs(c1.b - c2.b) < 0.001 &&
    Math.abs(c1.a - c2.a) < 0.001;
  if (!same) return null;
  return c1;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { stripped: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let stripped = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    if (!Array.isArray(node.attrOrder)) node.attrOrder = Object.keys(node.attrs);
    const style = getAttrValue(node.attrs, "style");
    if (!style) return;

    const styleMap = parseStyle(style);
    const bgImage = styleMap.get("background-image");
    const isSectionLike = /^(section|header)$/i.test(String(node.tag || ""));
    let normalizedDegenerateGradient = false;
    if (isSectionLike && bgImage) {
      const gradientColor = parseDegenerateGradientColor(bgImage);
      if (gradientColor) {
        const bgClass = colorToHexClass(gradientColor);
        if (bgClass) {
          const tokens = getClassTokens(node.attrs);
          if (!tokens.some((t) => normalizeToken(t) === normalizeToken(bgClass))) {
            tokens.push(bgClass);
            setClassTokens(node.attrs, node.attrOrder, tokens);
          }
        }
        styleMap.delete("background-image");
        styleMap.delete("background-size");
        styleMap.delete("background-position");
        styleMap.delete("background-repeat");
        if (trim(styleMap.get("background-blend-mode")).toLowerCase() === "normal") {
          styleMap.delete("background-blend-mode");
        }
        normalizedDegenerateGradient = true;
      }
    }
    const width = styleMap.get("width");
    const hasWidth100 = width && String(width).replace(/\s+/g, "") === "100%";

    if (!hasWidth100 && !normalizedDegenerateGradient) return;

    if (hasWidth100) styleMap.delete("width");

    const tokens = getClassTokens(node.attrs);
    const hasWFull = tokens.some((t) => normalizeToken(t) === "w-full");
    if (hasWidth100 && !hasWFull) {
      tokens.push("w-full");
      setClassTokens(node.attrs, node.attrOrder, tokens);
    }

    const serialized = serializeStyle(styleMap);
    if (serialized) {
      setAttrValue(node.attrs, node.attrOrder, "style", serialized);
    } else {
      removeAttr(node.attrs, node.attrOrder, "style");
    }

    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "styleReplace",
      value: hasWidth100 ? "strip width:100%" : "normalize degenerate background gradient",
      reason: hasWidth100
        ? "Replaced inline width with w-full"
        : "Converted same-color linear-gradient background to bg class",
    });
    stripped += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { stripped },
  };
};

module.exports = {
  id,
  apply,
};
