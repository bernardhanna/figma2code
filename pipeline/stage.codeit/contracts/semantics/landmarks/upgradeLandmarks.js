const {
  applyPatches,
  buildOpenTag,
  createPatch,
  parseHtmlNodes,
} = require("../../utils/html");
const { getNodeMeta, isTopLevel } = require("../../utilities/select");

const id = "semantics/landmarks/upgradeLandmarks";

const SAFE_KEEP_TAGS = new Set(["section", "header", "footer", "nav", "main", "aside", "article"]);

const shouldUpgrade = (node, nodes) => {
  if (!node) return false;
  if (!isTopLevel(node, nodes)) return false;
  if (SAFE_KEEP_TAGS.has(node.tag)) return false;
  return node.tag === "div";
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { upgraded: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let upgraded = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    if (!shouldUpgrade(node, nodes)) return;

    const nextTag = "section";
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(nextTag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
    if (!node.isSelfClosing && node.closeStart !== null && node.closeEnd !== null) {
      patches.push(createPatch(node.closeStart, node.closeEnd, `</${nextTag}>`));
    }

    const meta = getNodeMeta(node);
    changes.push({
      contractId: id,
      nodeId: meta.nodeId,
      selector: meta.selector,
      op: "attrAdd",
      value: "tag=section",
      reason: "semantic: upgraded wrapper(s) to <section>",
    });

    upgraded += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { upgraded },
  };
};

module.exports = {
  id,
  apply,
};
