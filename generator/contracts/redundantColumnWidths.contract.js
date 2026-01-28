import {
  buildOpenTag,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const FIXED_WIDTH_RE = /^w-\[[^\]]+\]$/;
const FIXED_HEIGHT_RE = /^h-\[[^\]]+\]$/;
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span"]);
const WRAPPER_TAGS = new Set(["div", "section", "header", "footer"]);

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

function hasFixedWidthToken(tokens) {
  return tokens.find((token) => {
    const { base, variant } = splitToken(token);
    return !variant && FIXED_WIDTH_RE.test(base);
  });
}

function hasFixedHeightBase(tokens) {
  return tokens.some((token) => {
    const { base, variant } = splitToken(token);
    return !variant && FIXED_HEIGHT_RE.test(base);
  });
}

function isLayoutRoot(tokens) {
  return tokens.some((token) => {
    const base = splitToken(token).base;
    return base === "grid" || base === "flex" || base.startsWith("grid-") || base.startsWith("flex-");
  });
}

function isResponsiveTwoColGrid(tokens) {
  if (!tokens.length) return false;
  const hasGrid = tokens.some((token) => splitToken(token).base === "grid");
  if (!hasGrid) return false;
  return tokens.some((token) => {
    const { variant, base } = splitToken(token);
    if (!variant || (variant !== "md" && variant !== "lg")) return false;
    return base === "grid-cols-2";
  });
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

function nodeHasDescendantTag(nodes, childrenMap, nodeIndex, tagName) {
  const stack = [...(childrenMap.get(nodeIndex) || [])];
  while (stack.length) {
    const idx = stack.pop();
    const node = nodes[idx];
    if (node.tag === tagName) return true;
    const children = childrenMap.get(idx) || [];
    for (const child of children) stack.push(child);
  }
  return false;
}

function getNodeLabel(node) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  const dataName = String(
    getAttrValue(node.attrs, "data-name") || getAttrValue(node.attrs, "data-node-name") || ""
  );
  return `${dataKey} ${dataName}`.toLowerCase();
}

function isDividerNode(node) {
  const label = getNodeLabel(node);
  return label.includes("decorativebar") || label.includes("divider");
}

function isHeroNode(node) {
  const label = getNodeLabel(node);
  return label.includes("hero");
}

function isTextOrSimpleWrapper(node, tokens) {
  if (TEXT_TAGS.has(node.tag)) return true;
  if (node.tag === "div" && !isLayoutRoot(tokens)) return true;
  return false;
}

export const redundantColumnWidths = {
  name: "redundantColumnWidths",
  order: 20,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const childrenMap = buildChildrenMap(nodes);
    const replacements = [];
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node, nodeIndex) => {
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length || !isResponsiveTwoColGrid(tokens)) return;

      const childIndices = childrenMap.get(nodeIndex) || [];
      for (const childIndex of childIndices) {
        const column = nodes[childIndex];
        const columnTokens = getClassTokens(column.attrs);
        const widthToken = hasFixedWidthToken(columnTokens);
        if (!widthToken) continue;
        if (!hasBaseToken(columnTokens, "max-w-full")) continue;

        const stack = [...(childrenMap.get(childIndex) || [])];
        while (stack.length) {
          const descendantIndex = stack.pop();
          const descendant = nodes[descendantIndex];
          const descendantTokens = getClassTokens(descendant.attrs);
          if (!descendantTokens.length) {
            const kids = childrenMap.get(descendantIndex) || [];
            kids.forEach((kid) => stack.push(kid));
            continue;
          }

          const hasWidth = descendantTokens.includes(widthToken);
          const hasMaxWFull = hasBaseToken(descendantTokens, "max-w-full");
          if (hasWidth && hasMaxWFull && isTextOrSimpleWrapper(descendant, descendantTokens)) {
            const cleaned = descendantTokens.filter((token) => token !== widthToken);
            const attrs = { ...descendant.attrs };
            const order = [...descendant.attrOrder];
            setClassTokens(attrs, order, cleaned);
            const replacement = buildOpenTag(descendant.tag, attrs, order, descendant.isSelfClosing);
            replacements.push({ start: descendant.openStart, end: descendant.openEnd, value: replacement });
            changedNodes += 1;
            notes.push("Removed redundant column width.");
          }

          const kids = childrenMap.get(descendantIndex) || [];
          kids.forEach((kid) => stack.push(kid));
        }
      }
    });

    nodes.forEach((node, nodeIndex) => {
      if (!WRAPPER_TAGS.has(node.tag)) return;
      if (node.tag === "img") return;
      if (isHeroNode(node) || isDividerNode(node)) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length || !hasFixedHeightBase(tokens)) return;
      if (nodeHasDescendantTag(nodes, childrenMap, nodeIndex, "img")) return;

      const cleaned = tokens.filter((token) => {
        const { base, variant } = splitToken(token);
        return variant || !FIXED_HEIGHT_RE.test(base);
      });
      const attrs = { ...node.attrs };
      const order = [...node.attrOrder];
      setClassTokens(attrs, order, cleaned);
      const replacement = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      replacements.push({ start: node.openStart, end: node.openEnd, value: replacement });
      changedNodes += 1;
      notes.push("Removed non-essential fixed height.");
    });

    const output = applyReplacements(html, replacements);
    return { html: output, changedNodes, notes };
  },
};

export default redundantColumnWidths;
