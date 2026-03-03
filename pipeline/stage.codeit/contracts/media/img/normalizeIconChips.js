const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "media/img/normalizeIconChips";

const normalizeToken = (token) => String(token || "").split(":").pop();

const extractHeight = (tokens) => {
  for (const token of tokens) {
    const core = normalizeToken(token);
    const rem = core.match(/^h-\[([0-9.]+rem)\]$/);
    if (rem) return rem[1];
    const px = core.match(/^h-\[([0-9.]+px)\]$/);
    if (px) return px[1];
  }
  return "";
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { normalized: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  let normalized = 0;

  nodes.forEach((node) => {
    if (String(node?.tag || "").toLowerCase() !== "img") return;
    if (!node?.attrs) return;
    const tokens = getClassTokens(node.attrs || {});
    if (!tokens.length) return;

    const cores = tokens.map(normalizeToken);
    const hasRoundedFull = cores.includes("rounded-full");
    const hasObjectContain = cores.includes("object-contain");
    const hasWFull = cores.includes("w-full");
    if (!hasRoundedFull || !hasObjectContain || !hasWFull) return;

    const h = extractHeight(tokens);
    if (!h) return;

    const next = [];
    const seen = new Set();
    for (const token of tokens) {
      const core = normalizeToken(token);
      if (core === "w-full") continue;
      if (core.startsWith("rounded-[") && hasRoundedFull) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      next.push(token);
    }
    const wToken = `w-[${h}]`;
    if (!next.some((t) => normalizeToken(t) === wToken)) next.push(wToken);

    setClassTokens(node.attrs, node.attrOrder, next);
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
      op: "iconChipNormalize",
      value: wToken,
      reason: "Icon chips should use square intrinsic width instead of stretching full width",
    });
    normalized += 1;
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { normalized },
  };
};

module.exports = {
  id,
  apply,
};
