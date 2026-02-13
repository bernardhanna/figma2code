const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/classes/dedupeConflictsHard";

const normalizeToken = (token) => String(token || "").split(":").pop();

const getPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(":");
};

const isArbitrary = (core) => core.includes("[");

const pickWinner = (list) => {
  if (!list.length) return null;
  const arbitrary = list.find((item) => isArbitrary(item.core));
  return (arbitrary || list[0]).token;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { resolved: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let resolved = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const parsed = tokens.map((token, index) => {
      const core = normalizeToken(token);
      const prefix = getPrefix(token);
      return { token, core, prefix, index };
    });

    const groups = new Map();
    parsed.forEach((item) => {
      if (!groups.has(item.prefix)) {
        groups.set(item.prefix, { gap: [], gapX: [], gapY: [], justify: [], items: [] });
      }
      const group = groups.get(item.prefix);
      if (/^gap-x-/.test(item.core)) group.gapX.push(item);
      else if (/^gap-y-/.test(item.core)) group.gapY.push(item);
      else if (/^gap-/.test(item.core)) group.gap.push(item);
      else if (/^justify-/.test(item.core)) group.justify.push(item);
      else if (/^items-/.test(item.core)) group.items.push(item);
    });

    const keep = new Set();
    groups.forEach((group) => {
      const keepGapX = pickWinner(group.gapX);
      const keepGapY = pickWinner(group.gapY);
      if (keepGapX) keep.add(keepGapX);
      if (keepGapY) keep.add(keepGapY);

      if (!group.gapX.length && !group.gapY.length) {
        const keepGap = pickWinner(group.gap);
        if (keepGap) keep.add(keepGap);
      }

      if (group.justify.length) {
        const last = group.justify[group.justify.length - 1].token;
        keep.add(last);
      }
      if (group.items.length) {
        const last = group.items[group.items.length - 1].token;
        keep.add(last);
      }
    });

    const cleaned = tokens.filter((token) => {
      const core = normalizeToken(token);
      if (/^gap-x-/.test(core) || /^gap-y-/.test(core) || /^gap-/.test(core)) {
        return keep.has(token);
      }
      if (/^justify-/.test(core) || /^items-/.test(core)) {
        return keep.has(token);
      }
      return true;
    });

    if (cleaned.length === tokens.length) return;

    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "classReplace",
      value: "dedupe conflicts",
      reason: "Resolved conflicting gap/items/justify utilities",
    });
    resolved += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { resolved },
  };
};

module.exports = {
  id,
  apply,
};
