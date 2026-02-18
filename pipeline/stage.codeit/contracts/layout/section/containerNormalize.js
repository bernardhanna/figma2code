const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/section/containerNormalize";

const normalizeToken = (token) => String(token || "").split(":").pop();

const CONTAINER_CANONICAL = "w-full max-w-[80rem] mx-auto";

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent == null) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const getElementChildren = (nodes, childrenMap, nodeIndex) =>
  (childrenMap.get(nodeIndex) || []).filter((i) => nodes[i]?.tag);

/** Div has w-full and at least one max-w-* in class list. */
const divHasContainerClasses = (node) => {
  const tokens = getClassTokens(node.attrs || {});
  const cores = tokens.map(normalizeToken);
  const hasWFull = cores.some((c) => c === "w-full");
  const hasMaxW = cores.some((c) => /^max-w-/.test(c));
  return hasWFull && hasMaxW;
};

/** Section-level tokens: padding and bg (preserve on section when swapping). */
const SECTION_LEVEL = /^(p-|px-|py-|pt-|pb-|pl-|pr-|bg-)/;
const isSectionLevelToken = (token) =>
  SECTION_LEVEL.test(normalizeToken(token));

/** Extract tokens from div that should stay on section (padding/bg). */
const sectionLevelTokensFrom = (tokens) =>
  tokens.filter((t) => isSectionLevelToken(t));

/** Merge section's classes with extra section-level tokens from div; dedupe by core. */
const mergeSectionClasses = (sectionTokens, divSectionLevel) => {
  const seen = new Set(sectionTokens.map(normalizeToken));
  const out = [...sectionTokens];
  for (const t of divSectionLevel) {
    const core = normalizeToken(t);
    if (!seen.has(core)) {
      out.push(t);
      seen.add(core);
    }
  }
  return out;
};

const mergeClasses = (aTokens, bTokens) => {
  const seen = new Set(aTokens.map(normalizeToken));
  const out = [...aTokens];
  for (const t of bTokens) {
    const core = normalizeToken(t);
    if (!seen.has(core)) {
      out.push(t);
      seen.add(core);
    }
  }
  return out;
};

const mergeAttrs = (baseAttrs, baseOrder, extraAttrs, extraOrder) => {
  const outAttrs = { ...baseAttrs };
  const outOrder = [...(baseOrder || [])];
  for (const key of extraOrder || Object.keys(extraAttrs || {})) {
    if (key === "class") continue;
    if (outAttrs[key] == null) {
      outAttrs[key] = extraAttrs[key];
      if (!outOrder.includes(key)) outOrder.push(key);
    }
  }
  return { outAttrs, outOrder };
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let normalized = 0;
  const skipDivs = new Set();

  nodes.forEach((node, nodeIndex) => {
    if (!node) return;

    // Case A: section > div.container > section (unwrap inner section into container)
    if ((node.tag || "").toLowerCase() === "section" && !node.isSelfClosing) {
      const children = getElementChildren(nodes, childrenMap, nodeIndex);
      if (children && children.length === 1) {
        const containerIndex = children[0];
        const container = nodes[containerIndex];
        if (
          container &&
          (container.tag || "").toLowerCase() === "div" &&
          !container.isSelfClosing &&
          divHasContainerClasses(container)
        ) {
          const innerChildren = getElementChildren(nodes, childrenMap, containerIndex);
          if (innerChildren && innerChildren.length === 1) {
            const innerSectionIndex = innerChildren[0];
            const innerSection = nodes[innerSectionIndex];
            if (
              innerSection &&
              (innerSection.tag || "").toLowerCase() === "section" &&
              !innerSection.isSelfClosing &&
              innerSection.closeStart != null
            ) {
              const containerTokens = getClassTokens(container.attrs || {});
              const innerTokens = getClassTokens(innerSection.attrs || {});
              const mergedContainerClasses = mergeClasses(containerTokens, innerTokens);

              const { outAttrs, outOrder } = mergeAttrs(
                container.attrs || {},
                container.attrOrder || [],
                innerSection.attrs || {},
                innerSection.attrOrder || []
              );
              setClassTokens(outAttrs, outOrder, mergedContainerClasses);
              const containerOpen = buildOpenTag("div", outAttrs, outOrder, false);
              const innerContent = source.slice(innerSection.openEnd, innerSection.closeStart);
              const replacement = containerOpen + innerContent + "</div>";

              patches.push(
                createPatch(container.openStart, container.closeEnd, replacement)
              );
              skipDivs.add(containerIndex);
              const meta = getNodeMeta(innerSection);
              changes.push({
                contractId: id,
                nodeId: meta.nodeId,
                selector: meta.selector,
                op: "containerNormalize",
                value: "unwrap inner section",
                reason: "Removed nested section under container div",
              });
              normalized += 1;
              return;
            }
          }
        }
      }
    }

    if (!node || (node.tag || "").toLowerCase() !== "div") return;
    if (skipDivs.has(nodeIndex)) return;
    if (node.isSelfClosing) return;
    if (!divHasContainerClasses(node)) return;

    const children = getElementChildren(nodes, childrenMap, nodeIndex);
    if (!children || children.length !== 1) return;
    const sectionIndex = children[0];
    const section = nodes[sectionIndex];
    if (!section || (section.tag || "").toLowerCase() !== "section") return;
    if (section.isSelfClosing || section.closeStart == null) return;

    const sectionTokens = getClassTokens(section.attrs || {});
    const divTokens = getClassTokens(node.attrs || {});
    const divSectionLevel = sectionLevelTokensFrom(divTokens);
    const mergedSectionClasses = mergeSectionClasses(
      sectionTokens,
      divSectionLevel
    );

    const sectionAttrs = { ...section.attrs };
    const sectionOrder = [...(section.attrOrder || [])];
    setClassTokens(sectionAttrs, sectionOrder, mergedSectionClasses);

    const sectionOpen = buildOpenTag(
      "section",
      sectionAttrs,
      sectionOrder,
      false
    );
    const innerDivAttrs = { class: CONTAINER_CANONICAL };
    const innerDivOrder = ["class"];
    const innerDivOpen = buildOpenTag(
      "div",
      innerDivAttrs,
      innerDivOrder,
      false
    );
    const sectionInnerContent = source.slice(
      section.openEnd,
      section.closeStart
    );
    const replacement =
      sectionOpen +
      innerDivOpen +
      sectionInnerContent +
      "</div>" +
      "</section>";

    patches.push(
      createPatch(node.openStart, node.closeEnd, replacement)
    );
    const meta = getNodeMeta(section);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "containerNormalize",
      value: "section > container",
      reason: "Swapped div wrapper with section; section outer, container inner",
    });
    normalized += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
