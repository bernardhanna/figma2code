import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const SECTION_TAGS = new Set(["div", "section", "main", "header"]);
const EXCLUDED_TAGS = new Set(["a", "button", "input", "select", "textarea"]);
const BRACKET_PT_RE = /^pt-\[([^\]]+)\]$/;
const BRACKET_PB_RE = /^pb-\[([^\]]+)\]$/;
const BRACKET_PR_RE = /^pr-\[[^\]]+\]$/;
const BRACKET_PL_RE = /^pl-\[[^\]]+\]$/;
const TINY_HEIGHT_RE = /^h-\[0\.3125rem\]$/;

function splitToken(token) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === "[") depth += 1;
    if (ch === "]" && depth > 0) depth -= 1;
    if (ch === ":" && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  const base = parts.pop() || "";
  const variant = parts.join(":");
  return { variant, base };
}

function findBaseBracket(tokens, regex) {
  for (let i = 0; i < tokens.length; i += 1) {
    const { variant, base } = splitToken(tokens[i]);
    if (variant) continue;
    const match = base.match(regex);
    if (match) return { token: tokens[i], value: match[1], index: i };
  }
  return null;
}

function hasBaseBracket(tokens, regex) {
  return tokens.some((token) => {
    const { variant, base } = splitToken(token);
    if (variant) return false;
    return regex.test(base);
  });
}

function hasBackgroundToken(tokens) {
  return tokens.some((token) => splitToken(token).base.startsWith("bg-"));
}

function hasContainerWidth(tokens) {
  const hasMaxW = tokens.some((token) => splitToken(token).base.startsWith("max-w-"));
  const hasMaxWFull = tokens.some((token) => splitToken(token).base === "max-w-full");
  const hasWBracket = tokens.some((token) => {
    const { variant, base } = splitToken(token);
    return !variant && /^w-\[[^\]]+\]$/.test(base);
  });
  const hasWFull = tokens.some((token) => splitToken(token).base === "w-full");
  return (hasMaxW && (hasWBracket || hasWFull)) || hasMaxWFull;
}

function isDecorative(label, tokens) {
  if (label.includes("decorativebar") || label.includes("divider")) return true;
  return tokens.some((token) => {
    const base = splitToken(token).base.toLowerCase();
    return base.includes("decorativebar") || base.includes("divider");
  });
}

function getLabel(node) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  const dataName = String(
    getAttrValue(node.attrs, "data-name") || getAttrValue(node.attrs, "data-node-name") || ""
  );
  const className = String(getAttrValue(node.attrs, "class") || "");
  return `${dataKey} ${dataName} ${className}`.toLowerCase();
}

function shouldSkipNode(node, tokens) {
  if (!SECTION_TAGS.has(node.tag)) return true;
  if (EXCLUDED_TAGS.has(node.tag)) return true;
  const label = getLabel(node);
  if (isDecorative(label, tokens)) return true;
  if (tokens.some((token) => TINY_HEIGHT_RE.test(splitToken(token).base))) return true;
  return false;
}

export const sectionPaddingContract = {
  name: "sectionPadding",
  order: 240,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (shouldSkipNode(node, tokens)) return;

      const ptBase = findBaseBracket(tokens, BRACKET_PT_RE);
      const pbBase = findBaseBracket(tokens, BRACKET_PB_RE);
      if (!ptBase || !pbBase) return;

      const hasPrPl = hasBaseBracket(tokens, BRACKET_PR_RE) && hasBaseBracket(tokens, BRACKET_PL_RE);
      if (!hasPrPl && !hasContainerWidth(tokens) && !hasBackgroundToken(tokens)) return;

      const removeIdx = new Set();
      tokens.forEach((token, idx) => {
        const { variant, base } = splitToken(token);
        if (!variant) return;
        if (variant === "md" || variant === "max-md") {
          if (BRACKET_PT_RE.test(base) || BRACKET_PB_RE.test(base)) removeIdx.add(idx);
        }
      });

      const nextTokens = [];
      let ptNewIndex = -1;
      let pbNewIndex = -1;
      tokens.forEach((token, idx) => {
        if (removeIdx.has(idx)) return;
        if (idx === ptBase.index) {
          nextTokens.push("pt-[2.5rem]");
          ptNewIndex = nextTokens.length - 1;
          return;
        }
        if (idx === pbBase.index) {
          nextTokens.push("pb-[2.5rem]");
          pbNewIndex = nextTokens.length - 1;
          return;
        }
        nextTokens.push(token);
      });

      const ptOriginal = ptBase.value || "2.5rem";
      const pbOriginal = pbBase.value || "2.5rem";

      if (ptOriginal !== "2.5rem") {
        const insertAt = ptNewIndex >= 0 ? ptNewIndex + 1 : nextTokens.length;
        nextTokens.splice(insertAt, 0, `md:pt-[${ptOriginal}]`);
        if (pbNewIndex >= insertAt) pbNewIndex += 1;
      }
      if (pbOriginal !== "2.5rem") {
        const insertAt = pbNewIndex >= 0 ? pbNewIndex + 1 : nextTokens.length;
        nextTokens.splice(insertAt, 0, `md:pb-[${pbOriginal}]`);
      }

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push("Adjusted section padding for md-and-below.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default sectionPaddingContract;
