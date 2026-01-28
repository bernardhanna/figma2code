import {
  buildOpenTag,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const FIXED_WIDTH_RE = /^w-\[[^\]]+\]$/;

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

function hasBaseToken(tokens, baseValue) {
  return tokens.some((token) => splitToken(token).base === baseValue);
}

function hasFixedWidth(tokens) {
  return tokens.some((token) => {
    const { base, variant } = splitToken(token);
    return !variant && FIXED_WIDTH_RE.test(base);
  });
}

function isLayoutRoot(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    return base === "grid" || base === "flex" || base.startsWith("grid-") || base.startsWith("flex-");
  });
}

function isConstrainedContainer(tokens) {
  const hasMaxW = tokens.some((token) => splitToken(token).base.startsWith("max-w-"));
  const hasMxAuto = hasBaseToken(tokens, "mx-auto");
  const hasFull = hasBaseToken(tokens, "w-full") || hasBaseToken(tokens, "max-w-full");
  return hasMaxW && hasMxAuto && hasFull;
}

function applyReplacements(html, replacements) {
  if (!replacements.length) return html;
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  let out = String(html || "");
  for (const rep of ordered) {
    out = out.slice(0, rep.start) + rep.value + out.slice(rep.end);
  }
  return out;
}

export const innerConstrainedWidth = {
  name: "innerConstrainedWidth",
  order: 10,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const childrenByParent = new Map();
    nodes.forEach((node, idx) => {
      if (node.parentIndex === null || node.parentIndex === undefined) return;
      const list = childrenByParent.get(node.parentIndex) || [];
      list.push(idx);
      childrenByParent.set(node.parentIndex, list);
    });

    const replacements = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node, nodeIndex) => {
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length || !isConstrainedContainer(tokens)) return;

      const childIndices = childrenByParent.get(nodeIndex) || [];
      for (const childIndex of childIndices) {
        const child = nodes[childIndex];
        const childTokens = getClassTokens(child.attrs);
        if (!childTokens.length || !isLayoutRoot(childTokens)) continue;
        if (!hasBaseToken(childTokens, "w-full") && !hasBaseToken(childTokens, "max-w-full")) continue;
        if (!hasFixedWidth(childTokens)) continue;

        const cleaned = childTokens.filter((token) => {
          const { base, variant } = splitToken(token);
          return variant || !FIXED_WIDTH_RE.test(base);
        });
        const attrs = { ...child.attrs };
        const order = [...child.attrOrder];
        setClassTokens(attrs, order, cleaned);
        const replacement = buildOpenTag(child.tag, attrs, order, child.isSelfClosing);
        replacements.push({ start: child.openStart, end: child.openEnd, value: replacement });
        changedNodes += 1;
        notes.push("Removed fixed width from constrained layout root.");
      }
    });

    const output = applyReplacements(html, replacements);
    return { html: output, changedNodes, notes };
  },
};

export default innerConstrainedWidth;
