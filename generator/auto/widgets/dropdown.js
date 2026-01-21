// generator/auto/widgets/dropdown.js
import { cls, remTypo } from "../autoLayoutify/precision.js";
import { twFontClassForFamily } from "../autoLayoutify/fonts.js";
import { visibleStroke } from "../autoLayoutify/stroke.js";
import { parseWidgetDirective } from "./utils.js";

const PLACEHOLDER_RE = /\b(select|choose)\b/i;
const OPTION_GROUP_RE = /\b(options|items|list)\b/i;
const ARROW_RE = /\b(chevron|caret|arrow|down)\b/i;

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function hasFill(node) {
  return Array.isArray(node?.fills) && node.fills.some((f) => f && f.kind && f.kind !== "none");
}

function hasBorder(node) {
  return !!visibleStroke(node);
}

function looksRectangular(node) {
  const w = Number(node?.w || 0);
  const h = Number(node?.h || 0);
  if (!w || !h) return false;
  return w >= h * 1.4;
}

function textNodesWithContext(root) {
  const out = [];
  const seen = new Set();
  (function walk(n, inOptions) {
    if (!n || seen.has(n)) return;
    seen.add(n);
    const name = String(n?.name || "").toLowerCase();
    const isOptions = !inOptions && OPTION_GROUP_RE.test(name);
    const withinOptions = inOptions || isOptions;
    if (isOptions && n?.id) {
      out.push({ node: n, kind: "options-group" });
    }
    if (n?.text?.raw && String(n.text.raw).trim()) {
      out.push({ node: n, kind: withinOptions ? "option-text" : "placeholder-text" });
    }
    for (const c of n.children || []) walk(c, withinOptions);
  })(root, false);
  return out;
}

function extractOptions(root) {
  const found = textNodesWithContext(root);
  const optionGroupIds = new Set(
    found.filter((x) => x.kind === "options-group").map((x) => x.node?.id).filter(Boolean)
  );
  const optionTexts = found
    .filter((x) => x.kind === "option-text")
    .map((x) => String(x.node?.text?.raw || "").trim())
    .filter(Boolean);

  const placeholderNodes = found
    .filter((x) => x.kind === "placeholder-text")
    .map((x) => x.node);

  return { optionTexts, optionGroupIds, placeholderNodes };
}

function pickPlaceholderNode(nodes) {
  if (!nodes?.length) return null;
  const match = nodes.find((n) => PLACEHOLDER_RE.test(String(n?.text?.raw || "")));
  return match || nodes[0] || null;
}

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const s of list) {
    const v = String(s || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildOptions(placeholderText, optionTexts) {
  const cleaned = uniqueStrings(optionTexts);
  const fallback = cleaned.length ? cleaned : ["Option 1", "Option 2", "Option 3"];
  const placeholder = placeholderText || "Select an option";

  const options = [{ label: placeholder, value: "" }];
  for (const label of fallback) {
    if (label === placeholder) continue;
    options.push({ label, value: label });
  }
  return options;
}

function textClassesFromNode(textNode, ctx) {
  if (!textNode) return "";
  const t = textNode.text || {};
  const typo = textNode.typography || {};

  const family = String(
    typo.family || t.fontFamily || t.family || t.fontName?.family || ""
  ).trim();
  const ffClass = family ? twFontClassForFamily(family, ctx?.fontMap || {}) : "";

  const fontSizePx = typeof typo.sizePx === "number" ? typo.sizePx : t.fontSize;
  const lineHeightPx =
    typeof typo.lineHeightPx === "number"
      ? typo.lineHeightPx
      : typeof t.lineHeightPx === "number"
        ? t.lineHeightPx
        : null;
  const letterSpacingPx =
    typeof typo.letterSpacingPx === "number"
      ? typo.letterSpacingPx
      : typeof t.letterSpacingPx === "number"
        ? t.letterSpacingPx
        : 0;

  const fs = fontSizePx ? `text-[${remTypo(fontSizePx)}]` : "";
  const lh =
    typeof lineHeightPx === "number" && lineHeightPx > 0
      ? `leading-[${remTypo(lineHeightPx)}]`
      : "";
  const ls =
    typeof letterSpacingPx === "number" && letterSpacingPx !== 0
      ? `tracking-[${remTypo(letterSpacingPx)}]`
      : "";

  const weight = typeof typo.weight === "number" ? typo.weight : t.fontWeight;
  const fw = weight ? `font-[${weight}]` : "";

  const hex = String(typo.colorHex || t.colorHex || t.fillHex || "").trim();
  const color = hex ? `text-[${hex}]` : "";

  const ital = t.italic ? "italic" : "";
  const tt = t.uppercase ? "uppercase" : "";
  const decoText =
    t.decoration === "underline"
      ? "underline"
      : t.decoration === "line-through"
        ? "line-through"
        : "";

  return cls(ffClass, fs, lh, ls, fw, color, ital, tt, decoText);
}

function hasDirectiveDescendant(node) {
  let found = false;
  (function walk(n) {
    if (!n || found) return;
    for (const c of n.children || []) {
      const parsed = parseWidgetDirective(c?.name);
      if (parsed?.type === "dropdown") {
        found = true;
        return;
      }
      walk(c);
    }
  })(node);
  return found;
}

function findArrowCandidate(root) {
  let found = null;

  const seen = new Set();
  (function walk(n, parent) {
    if (!n || found || seen.has(n)) return;
    seen.add(n);
    for (const c of n.children || []) {
      const name = String(c?.name || "").toLowerCase();
      const isVector =
        !!c?.svg ||
        !!c?.vector ||
        String(c?.type || "").toUpperCase() === "VECTOR" ||
        String(c?.type || "").toUpperCase() === "BOOLEAN_OPERATION";
      const looksArrow = ARROW_RE.test(name) || (isVector && name.includes("down"));
      if (looksArrow) {
        found = { node: c, parent: n };
        return;
      }
      walk(c, n);
    }
  })(root, null);

  return found;
}

function removeNodesById(root, removeIds) {
  if (!root || !removeIds || !removeIds.size) return;
  const seen = new Set();
  (function walk(n) {
    if (!n || seen.has(n)) return;
    seen.add(n);
    const kids = Array.isArray(n.children) ? n.children : [];
    n.children = kids.filter((c) => !removeIds.has(c?.id));
    for (const c of n.children) walk(c);
  })(root);
}

function ensureSemanticsMap(ast) {
  if (!isObj(ast?.semantics)) ast.semantics = {};
  return ast.semantics;
}

export const id = "dropdown";

export function match(node, ctx) {
  if (!node || node.text) return false;
  if (node.__widgetSkip) return false;
  if (node.__widgetApplied && node.__widgetApplied.dropdown) return false;

  const directive = parseWidgetDirective(node.name);
  if (directive?.type === "dropdown") return true;
  if (hasDirectiveDescendant(node)) return false;

  const { optionTexts, placeholderNodes } = extractOptions(node);
  const placeholderNode = pickPlaceholderNode(placeholderNodes);
  const placeholder = String(placeholderNode?.text?.raw || "").trim();

  const arrow = findArrowCandidate(node);

  const hasBox = hasFill(node) || hasBorder(node);
  const hasPlaceholder = !!placeholder || optionTexts.some((t) => PLACEHOLDER_RE.test(t));
  const hasArrow = !!arrow;

  return hasPlaceholder && hasArrow && (hasBox || looksRectangular(node));
}

export function apply(node, ctx) {
  if (!node || node.text) return;

  const directive = parseWidgetDirective(node.name);
  const existing = isObj(node.__widget) ? node.__widget : null;

  node.__widget = {
    type: "dropdown",
    enhance: existing?.enhance || directive?.enhance || null,
    scope: existing?.scope || directive?.scope || "all",
    sourceName: existing?.sourceName || directive?.sourceName || String(node.name || "").trim(),
  };

  const { optionTexts, optionGroupIds, placeholderNodes } = extractOptions(node);
  const placeholderNode = pickPlaceholderNode(placeholderNodes);
  const placeholder = String(placeholderNode?.text?.raw || "").trim();
  const placeholderIndex = Array.isArray(node.children)
    ? node.children.findIndex((c) => c === placeholderNode || c?.id === placeholderNode?.id)
    : -1;

  const options = buildOptions(placeholder, optionTexts);

  const baseId = String(node?.id || node?.name || "dropdown").replace(/\s+/g, "_");
  const arrowCandidate = findArrowCandidate(node);
  let arrowWrapper = null;
  if (arrowCandidate?.node && arrowCandidate?.parent) {
    arrowCandidate.parent.children = (arrowCandidate.parent.children || []).filter(
      (c) => c !== arrowCandidate.node
    );
    arrowWrapper = {
      id: `${baseId}__arrow`,
      name: `${node.name || "Dropdown"} Arrow`,
      type: "FRAME",
      children: [arrowCandidate.node],
      tw: "pointer-events-none absolute right-4 top-1/2 -translate-y-1/2",
      __widgetSkip: true,
      __widgetApplied: { dropdown: true },
    };
  }

  const removeIds = new Set(optionGroupIds);
  if (placeholderNode?.id) removeIds.add(placeholderNode.id);
  removeNodesById(node, removeIds);

  const selectNode = {
    id: `${baseId}__select`,
    name: `${node.name || "Dropdown"} Select`,
    type: "SELECT",
    __options: options,
    __widgetSkip: true,
    __widgetApplied: { dropdown: true },
  };

  const textClasses = textClassesFromNode(placeholderNode, ctx);
  const arrowPad = arrowWrapper ? "pr-10" : "";
  const bgTransparent = hasFill(node) ? "bg-transparent" : "";
  const styleHints = ctx?.styleHints || {};
  const widthClasses = styleHints?.containerClass ? "w-full max-w-full" : "w-full";

  selectNode.tw = cls(
    "block",
    widthClasses,
    "min-w-0",
    "appearance-none",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    arrowPad,
    bgTransparent,
    textClasses
  );

  if (node.__widget.enhance === "nice-select") {
    selectNode.attrs = { "data-widget": "nice-select" };
  }

  const semantics = ensureSemanticsMap(ctx?.ast);
  semantics[selectNode.id] = { tag: "select" };

  node.tw = cls(node.tw, "relative");

  const nextChildren = Array.isArray(node.children) ? node.children.slice() : [];
  const insertAt =
    placeholderIndex >= 0 ? Math.min(placeholderIndex, nextChildren.length) : 0;
  nextChildren.splice(insertAt, 0, selectNode);
  if (arrowWrapper) nextChildren.push(arrowWrapper);
  node.children = nextChildren;
}

export default { id, match, apply };
