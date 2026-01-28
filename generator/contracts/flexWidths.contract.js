import {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} from "./contractTypes.js";

const BRACKET_WIDTH_RE = /^w-\[[^\]]+\]$/;
const FLEX_DIRECTIONS = new Set(["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse"]);

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

function getLabel(node) {
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  const dataName = String(
    getAttrValue(node.attrs, "data-name") || getAttrValue(node.attrs, "data-node-name") || ""
  );
  return `${dataKey} ${dataName}`.toLowerCase();
}

function isDecorative(node) {
  const label = getLabel(node);
  return label.includes("decorativebar") || label.includes("divider");
}

function hasBgImageToken(tokens) {
  return tokens.some((token) => splitToken(token).base.includes("bg-[url("));
}


function hasBaseToken(tokens, baseValue) {
  return tokens.some((token) => splitToken(token).base === baseValue);
}

function hasVariantBaseToken(tokens, variantValue, baseValue) {
  return tokens.some((token) => {
    const { variant, base } = splitToken(token);
    return variant === variantValue && base === baseValue;
  });
}

function isFlexContainer(tokens) {
  return hasBaseToken(tokens, "flex");
}

function hasGridDisplay(tokens) {
  return tokens.some((token) => splitToken(token).base === "grid");
}

function isFlexRowLike(tokens) {
  const hasExplicitRow = hasBaseToken(tokens, "flex-row");
  const hasExplicitDirection = tokens.some((token) => FLEX_DIRECTIONS.has(splitToken(token).base));
  return hasExplicitRow || !hasExplicitDirection;
}

function isMdRowLike(tokens) {
  const hasMdRow = hasVariantBaseToken(tokens, "md", "flex-row");
  const hasMdCol = hasVariantBaseToken(tokens, "md", "flex-col");
  return hasMdRow || !hasMdCol;
}

function removeBracketWidths(tokens) {
  return tokens.filter((token) => !BRACKET_WIDTH_RE.test(splitToken(token).base));
}

export const flexWidthsContract = {
  name: "flexWidths",
  order: 230,
  apply(html) {
    const nodes = parseHtmlNodes(html);
    const childrenMap = buildChildrenMap(nodes);
    const patches = [];
    const patchIndexByNode = new Map();
    const notes = [];
    let changedNodes = 0;

    nodes.forEach((node, nodeIndex) => {
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;
      if (!isFlexContainer(tokens)) return;
      if (hasGridDisplay(tokens)) return;
      if (!isFlexRowLike(tokens)) return;
      if (!isMdRowLike(tokens)) return;

      const childIndices = childrenMap.get(nodeIndex) || [];
      if (childIndices.length !== 2) return;

      for (const childIndex of childIndices) {
        const child = nodes[childIndex];
        const childTokens = getClassTokens(child.attrs);
        if (!childTokens.length) continue;
        if (isDecorative(child) || hasBgImageToken(childTokens)) continue;

        const cleaned = removeBracketWidths(childTokens);
        if (!hasBaseToken(cleaned, "w-full")) cleaned.push("w-full");
        if (!hasVariantBaseToken(cleaned, "md", "w-1/2")) cleaned.push("md:w-1/2");

        const attrs = { ...child.attrs };
        const order = [...child.attrOrder];
        setClassTokens(attrs, order, cleaned);
        const replacement = buildOpenTag(child.tag, attrs, order, child.isSelfClosing);
        const patch = createPatch(child.openStart, child.openEnd, replacement);
        const existing = patchIndexByNode.get(childIndex);
        if (existing) {
          if (existing.kind === "desc") {
            patches[existing.index] = patch;
            patchIndexByNode.set(childIndex, { kind: "child", index: existing.index });
          }
        } else {
          patches.push(patch);
          patchIndexByNode.set(childIndex, { kind: "child", index: patches.length - 1 });
          changedNodes += 1;
          notes.push("Normalized flex column widths.");
        }

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
          if (descendant.tag === "img" || descendant.tag === "svg") {
            const kids = childrenMap.get(descendantIndex) || [];
            kids.forEach((kid) => stack.push(kid));
            continue;
          }
          if (isDecorative(descendant) || hasBgImageToken(descendantTokens)) {
            const kids = childrenMap.get(descendantIndex) || [];
            kids.forEach((kid) => stack.push(kid));
            continue;
          }
          const cleanedDesc = removeBracketWidths(descendantTokens);
          if (cleanedDesc.length !== descendantTokens.length) {
            const attrsDesc = { ...descendant.attrs };
            const orderDesc = [...descendant.attrOrder];
            setClassTokens(attrsDesc, orderDesc, cleanedDesc);
            const replacementDesc = buildOpenTag(
              descendant.tag,
              attrsDesc,
              orderDesc,
              descendant.isSelfClosing
            );
            const patchDesc = createPatch(descendant.openStart, descendant.openEnd, replacementDesc);
            if (!patchIndexByNode.has(descendantIndex)) {
              patches.push(patchDesc);
              patchIndexByNode.set(descendantIndex, {
                kind: "desc",
                index: patches.length - 1,
              });
              changedNodes += 1;
              notes.push("Removed nested bracket width.");
            }
          }

          const kids = childrenMap.get(descendantIndex) || [];
          kids.forEach((kid) => stack.push(kid));
        }
      }
    });

    const output = applyPatches(html, patches);
    return { html: output, changedNodes, notes };
  },
};

export default flexWidthsContract;
