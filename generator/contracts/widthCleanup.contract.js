import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

export const widthCleanupSystemContract = `SYSTEM CONTRACT — READ CAREFULLY

The HTML to be modified is ALREADY PROVIDED IN THE CONVERSATION CONTEXT.
DO NOT ask for HTML.
DO NOT request additional input.
DO NOT explain what you are doing.
DO NOT ask clarifying questions.

When asked to run the “Width Cleanup Pass”, you must RETURN the FULL UPDATED HTML ONLY.

OBJECTIVE:
Remove redundant or contradictory width constraints while preserving the visual layout.

SCOPE (STRICT):
- You may ONLY modify width-related Tailwind classes:
  w-*, max-w-*, min-w-*, basis-*, grow, shrink
- You may remove duplicated or contradictory width utilities.
- You may introduce responsive width variants ONLY when resolving a contradiction.

ABSOLUTE RULES:
- Do NOT change DOM structure or nesting.
- Do NOT change tag names.
- Do NOT change spacing (padding, margin, gap).
- Do NOT change height utilities.
- Do NOT change typography, colors, borders, shadows, hover/focus states.
- Do NOT change grid or flex direction/alignment.
- Do NOT remove min-w-0 where present.
- Do NOT invent new sizes.

WIDTH RULES:
1) If an element has w-[X] and max-w-full, remove max-w-full UNLESS it prevents mobile overflow.
2) If an element has both w-full and w-[X], resolve as:
   - w-full md:w-[X] for responsive layouts
   - w-[X] only when fixed width is clearly intended
3) Remove duplicated width tokens (e.g. repeated max-w-[80rem]).

OUTPUT FORMAT:
- When returning HTML: return the FULL updated HTML only, no explanations.

END SYSTEM CONTRACT
`;

const BRACKET_WIDTH_RE = /^w-\[[^\]]+\]$/;

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

function buildChildrenMap(nodes) {
  const map = new Map();
  nodes.forEach((node, idx) => {
    if (node.parentIndex === null || node.parentIndex === undefined) return;
    const list = map.get(node.parentIndex) || [];
    list.push(idx);
    map.set(node.parentIndex, list);
  });
  return map;
}

function isDecorative(node, tokens) {
  if (getAttrValue(node.attrs, "data-decorative") === "1") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("decorativebar")) return true;
  return tokens.some((token) => splitToken(token).base.toLowerCase().includes("decorativebar"));
}

function hasBgImage(tokens) {
  return tokens.some((token) => splitToken(token).base.includes("bg-[url("));
}

function isMediaTag(node) {
  return node.tag === "img" || node.tag === "svg" || node.tag === "video";
}

function findBracketWidthToken(tokens) {
  return tokens.find((token) => {
    const { base } = splitToken(token);
    return BRACKET_WIDTH_RE.test(base);
  });
}

function hasWidthToken(tokens) {
  return tokens.some((token) => {
    const { base } = splitToken(token);
    return base.startsWith("w-") || base.startsWith("basis-");
  });
}

function hasTypography(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    return (
      base.startsWith("text-") ||
      base.startsWith("font-") ||
      base.startsWith("leading-") ||
      base.startsWith("tracking-")
    );
  });
}

function isRootish(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    if (BRACKET_WIDTH_RE.test(base)) return true;
    if (base.startsWith("max-w-") && base !== "max-w-full") return true;
    return false;
  });
}

function removeBracketWidths(tokens) {
  return tokens.filter((token) => !BRACKET_WIDTH_RE.test(splitToken(token).base));
}

export const widthCleanupContract = {
  name: "widthCleanup",
  order: 430,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const childrenMap = buildChildrenMap(nodes);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    const widthMap = new Map();
    nodes.forEach((node, idx) => {
      const tokens = getClassTokens(node.attrs);
      const widthToken = findBracketWidthToken(tokens);
      if (widthToken) widthMap.set(idx, widthToken);
    });

    nodes.forEach((node, idx) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (isDecorative(node, tokens) || hasBgImage(tokens) || isMediaTag(node)) return;

      const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
      let nextTokens = [...tokens];
      let changed = false;

      if (intent === "fill" || intent === "hug") {
        const cleaned = removeBracketWidths(nextTokens);
        if (cleaned.length !== nextTokens.length) {
          nextTokens = cleaned;
          changed = true;
        }
        if (intent === "fill") {
          if (!nextTokens.some((token) => splitToken(token).base === "w-full")) {
            nextTokens.push("w-full");
            changed = true;
          }
        }
      }

      if (intent !== "fixed") {
        let parentIndex = node.parentIndex;
        while (parentIndex !== null && parentIndex !== undefined) {
          const parentWidth = widthMap.get(parentIndex);
          const selfWidth = findBracketWidthToken(nextTokens);
          if (parentWidth && selfWidth && parentWidth === selfWidth) {
            nextTokens = nextTokens.filter((token) => token !== selfWidth);
            changed = true;
            break;
          }
          parentIndex = nodes[parentIndex]?.parentIndex ?? null;
        }
      }

      const hasMaxWFull = nextTokens.some((token) => splitToken(token).base === "max-w-full");
      if (hasMaxWFull) {
        const keep =
          isMediaTag(node) ||
          hasWidthToken(nextTokens) ||
          hasTypography(nextTokens) ||
          isRootish(nextTokens);
        if (!keep) {
          nextTokens = nextTokens.filter((token) => splitToken(token).base !== "max-w-full");
          changed = true;
        }
      }

      if (!changed) return;
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Cleaned width tokens.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default widthCleanupContract;
