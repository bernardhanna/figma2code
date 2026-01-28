import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const MEDIA_TAGS = new Set(["img", "svg", "video"]);

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

function dedupeTokens(tokens) {
  const seen = new Set();
  const output = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    output.push(token);
  }
  return output;
}

function isDecorative(node) {
  if (String(getAttrValue(node.attrs, "data-decorative") || "") === "1") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  return dataKey.includes("decorativebar");
}

function hasBgImage(tokens) {
  return tokens.some((token) => splitToken(token).base.includes("bg-[url("));
}

function isRootish(node) {
  if (node.tag === "section") return true;
  return String(getAttrValue(node.attrs, "data-key") || "") === "root";
}

function hasBlockingTokens(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    if (base.startsWith("w-")) return true;
    if (base.startsWith("basis-")) return true;
    if (base === "grow" || base === "flex-1" || base === "shrink-0" || base === "min-w-0")
      return true;
    if (
      base === "whitespace-pre-wrap" ||
      base === "break-words" ||
      base === "break-all" ||
      base === "truncate" ||
      base.startsWith("line-clamp-")
    )
      return true;
    if (base === "overflow-hidden" || base === "overflow-auto" || base === "overflow-scroll")
      return true;
    return false;
  });
}

export const maxWFullDedupeContract = {
  name: "maxWFullDedupe",
  order: 285,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    for (const node of nodes) {
      if (!node.attrs || !getAttrValue(node.attrs, "class")) continue;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) continue;

      const deduped = dedupeTokens(tokens);
      let nextTokens = deduped;
      let changed = deduped.length !== tokens.length;

      if (
        nextTokens.includes("max-w-full") &&
        node.tag === "div" &&
        !MEDIA_TAGS.has(node.tag) &&
        !isRootish(node) &&
        !isDecorative(node) &&
        !hasBgImage(nextTokens) &&
        !hasBlockingTokens(nextTokens)
      ) {
        nextTokens = nextTokens.filter((token) => token !== "max-w-full");
        changed = true;
      }

      if (!changed) continue;
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, nextTokens);
      const open = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, open));
      changedNodes += 1;
      notes.push("Deduped class tokens and pruned max-w-full.");
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default maxWFullDedupeContract;
