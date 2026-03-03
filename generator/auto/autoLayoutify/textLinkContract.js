// generator/auto/autoLayoutify/textLinkContract.js
function splitTokens(classString) {
  return String(classString || "").split(/\s+/g).filter(Boolean);
}

function dedupe(tokens) {
  return Array.from(new Set(tokens));
}

function removeByPatterns(tokens, patterns) {
  return tokens.filter((t) => !patterns.some((rx) => rx.test(t)));
}

function addTokens(tokens, toAdd) {
  return dedupe([...tokens, ...toAdd.filter(Boolean)]);
}

function firstTextChild(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  return kids.find((c) => typeof c?.text?.raw === "string" && c.text.raw.trim()) || null;
}

function iconish(node) {
  if (!node || typeof node !== "object") return false;
  if (node?.img?.src) return true;
  const t = String(node?.type || "").toUpperCase();
  if (t === "SVG" || t === "VECTOR" || t === "ELLIPSE" || t === "BOOLEAN_OPERATION") return true;
  const n = String(node?.name || "").toLowerCase();
  const k = String(node?.key || "").toLowerCase();
  return /\b(icon|arrow|chevron|caret|glyph|vector)\b/.test(n) || /\b(icon|arrow|chevron|caret|glyph|vector)\b/.test(k);
}

function hasIconDescendant(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  for (const c of kids) {
    if (iconish(c)) return true;
    if (hasIconDescendant(c)) return true;
  }
  return false;
}

const FLEX_DIR_PATTERNS = [/^(?:\w+:)?flex-(?:row|col)(?:-reverse)?$/];
const WIDTH_PATTERNS = [
  /^(?:\w+:)?!?w-full$/,
  /^(?:\w+:)?!?w-\[[^\]]+\]$/,
  /^(?:\w+:)?!?w-fit$/,
  /^(?:\w+:)?!?w-auto$/,
  /^(?:\w+:)?!?w-screen$/,
  /^(?:\w+:)?!?max-w-.+$/,
  /^(?:\w+:)?!?min-w-.+$/,
  /^(?:\w+:)?!?basis-.+$/,
];
const CENTERING_PATTERNS = [/^(?:\w+:)?mx-auto$/, /^(?:\w+:)?justify-center$/, /^(?:\w+:)?items-(?:start|center|end|stretch|baseline)$/];
const GAP_PATTERNS = [/^(?:\w+:)?gap(?:-[xy])?-.+$/];
const GROW_PATTERNS = [/^(?:\w+:)?grow$/, /^(?:\w+:)?shrink$/, /^(?:\w+:)?shrink-0$/];

function cleanMutualConflicts(tokens, role) {
  let out = tokens.slice();
  out = removeByPatterns(out, FLEX_DIR_PATTERNS);
  out = removeByPatterns(out, GAP_PATTERNS);
  out = removeByPatterns(out, WIDTH_PATTERNS);
  out = removeByPatterns(out, CENTERING_PATTERNS);
  if (role !== "icon") out = removeByPatterns(out, GROW_PATTERNS);
  return out;
}

export function applyTextLinkClassContract({ node, classString, role = "root", hasIcon = false, strictWidth = false }) {
  let tokens = splitTokens(classString);
  tokens = cleanMutualConflicts(tokens, role);

  if (role === "root") {
    tokens = removeByPatterns(tokens, [/^(?:\w+:)?btn$/]);
    tokens = removeByPatterns(tokens, [/^(?:\w+:)?rounded(?:-[^\s]+)?$/]);
    tokens = addTokens(tokens, ["inline-flex", "items-center", hasIcon ? "gap-2" : "gap-1"]);
    if (!strictWidth) tokens = removeByPatterns(tokens, WIDTH_PATTERNS);
    tokens = removeByPatterns(tokens, [/^(?:\w+:)?mx-auto$/]);
    return dedupe(tokens).join(" ");
  }

  if (role === "container") {
    tokens = addTokens(tokens, ["inline-flex", "items-center", hasIcon ? "gap-2" : "gap-1"]);
    tokens = removeByPatterns(tokens, [/^(?:\w+:)?mx-auto$/]);
    return dedupe(tokens).join(" ");
  }

  if (role === "text") {
    tokens = removeByPatterns(tokens, WIDTH_PATTERNS);
    tokens = removeByPatterns(tokens, [/^(?:\w+:)?mx-auto$/, /^(?:\w+:)?justify-center$/]);
    return dedupe(tokens).join(" ");
  }

  if (role === "icon") {
    tokens = removeByPatterns(tokens, WIDTH_PATTERNS);
    tokens = removeByPatterns(tokens, [/^(?:\w+:)?mx-auto$/]);
    tokens = addTokens(tokens, ["shrink-0", "w-6", "h-6", "object-contain"]);
    return dedupe(tokens).join(" ");
  }

  return dedupe(tokens).join(" ");
}

export function textLinkRoleMap(rootNode) {
  const map = new Map();
  const hasIcon = hasIconDescendant(rootNode);
  if (rootNode?.id) map.set(rootNode.id, { role: "root", hasIcon });

  const kids = Array.isArray(rootNode?.children) ? rootNode.children : [];
  if (kids.length) {
    const container = kids[0];
    if (container?.id) map.set(container.id, { role: "container", hasIcon });
    const gkids = Array.isArray(container?.children) ? container.children : [];
    for (const g of gkids) {
      if (!g?.id) continue;
      if (iconish(g) || hasIconDescendant(g)) map.set(g.id, { role: "icon", hasIcon });
      else if (firstTextChild(g) || (typeof g?.text?.raw === "string" && g.text.raw.trim()))
        map.set(g.id, { role: "text", hasIcon });
    }
  }
  return map;
}
