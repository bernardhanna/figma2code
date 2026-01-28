import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

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

function shouldRemoveWidthToken(base) {
  if (!base.startsWith("w-")) return false;
  return base !== "w-full";
}

function normalizeFillTokens(tokens) {
  const cleaned = tokens.filter((token) => {
    const { base } = splitToken(token);
    return !shouldRemoveWidthToken(base);
  });
  if (!cleaned.some((token) => splitToken(token).base === "w-full")) {
    cleaned.push("w-full");
  }
  return cleaned;
}

export const widthIntentContract = {
  name: "widthIntent",
  order: 250,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const patches = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node) => {
      const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
      if (intent !== "fill") return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;

      const cleaned = normalizeFillTokens(tokens);
      if (cleaned.join(" ") === tokens.join(" ")) return;

      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, cleaned);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, replacement));
      changedNodes += 1;
      notes.push("Normalized width tokens for fill intent.");
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default widthIntentContract;
