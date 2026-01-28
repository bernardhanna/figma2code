import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const TEXT_TAGS = new Set(["div", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6"]);

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

function hasToken(tokens, value) {
  return tokens.some((token) => splitToken(token).base === value);
}

function hasPrefix(tokens, prefix) {
  return tokens.some((token) => splitToken(token).base.startsWith(prefix));
}

function isFlexOrGrid(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    return base === "flex" || base === "grid";
  });
}

function isHeadingMatch(node, tokens) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (!dataKey.includes("text:")) return false;
  const font = String(getAttrValue(node.attrs, "data-ff") || "").toLowerCase();
  const hasPlayfair =
    font.includes("playfair") || tokens.some((t) => splitToken(t).base.includes("playfair"));
  return (
    hasPlayfair &&
    hasToken(tokens, "text-[2.125rem]") &&
    hasToken(tokens, "font-[600]") &&
    hasToken(tokens, "leading-[2.5rem]")
  );
}

function isBodyMatch(node, tokens) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (!dataKey.includes("text:")) return false;
  const font = String(getAttrValue(node.attrs, "data-ff") || "").toLowerCase();
  const hasMontserrat =
    font.includes("montserrat") || tokens.some((t) => splitToken(t).base.includes("montserrat"));
  const sizeMatch =
    hasToken(tokens, "text-[1.125rem]") || hasToken(tokens, "text-[1rem]");
  const weightMatch = hasToken(tokens, "font-[500]") || hasToken(tokens, "font-[400]");
  return hasMontserrat && sizeMatch && weightMatch;
}

function shouldKeepMaxWFull(parentTokens, childTokens) {
  if (!parentTokens) return true;
  const parentHasWFull = hasToken(parentTokens, "w-full");
  if (!parentHasWFull) return true;
  if (!isFlexOrGrid(parentTokens)) return false;
  if (hasPrefix(childTokens, "w-") || hasPrefix(childTokens, "basis-")) return true;
  if (hasToken(childTokens, "shrink-0")) return true;
  return false;
}

export const semanticRestoreWidthCleanupContract = {
  name: "semanticRestoreWidthCleanup",
  order: 1010,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) return;
      if (!TEXT_TAGS.has(node.tag)) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;

      const parent =
        node.parentIndex !== null && node.parentIndex !== undefined
          ? nodes[node.parentIndex]
          : null;
      const parentTokens = parent ? getClassTokens(parent.attrs) : null;

      let nextTokens = [...tokens];
      let changed = false;
      let nextTag = node.tag;

      if (node.tag === "div" && isHeadingMatch(node, tokens)) {
        nextTag = "h2";
        changed = true;
      } else if (node.tag === "div" && isBodyMatch(node, tokens)) {
        nextTag = "p";
        changed = true;
      }

      if (nextTokens.includes("max-w-full") && parentTokens) {
        if (!shouldKeepMaxWFull(parentTokens, nextTokens)) {
          nextTokens = nextTokens.filter((token) => splitToken(token).base !== "max-w-full");
          changed = true;
          if (isFlexOrGrid(parentTokens)) {
            if (!hasToken(nextTokens, "w-full")) {
              nextTokens.push("w-full");
            }
            if (!hasToken(nextTokens, "min-w-0")) {
              nextTokens.push("min-w-0");
            }
          }
        }
      }

      if (!changed) return;
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(nextTag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      if (nextTag !== node.tag) {
        patches.push(createPatch(node.closeStart, node.closeEnd, `</${nextTag}>`));
      }
      changedNodes += 1;
      notes.push("Restored semantic tags and cleaned max-w-full.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default semanticRestoreWidthCleanupContract;
