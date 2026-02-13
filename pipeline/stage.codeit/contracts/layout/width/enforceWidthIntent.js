const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta, isMediaTag } = require("../../utilities/select");

const id = "layout/width/enforceWidthIntent";

const normalizeToken = (token) => String(token || "").split(":").pop();

const hasWidthConstraint = (tokens) => {
  const cores = tokens.map(normalizeToken);
  return cores.some((c) => /^w-/.test(c) || /^max-w-/.test(c) || /^basis-/.test(c));
};

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li"]);

const getWidthFromData = (node) => {
  const wRem = String(getAttrValue(node.attrs, "data-w-rem") || "").trim();
  if (wRem && /^[0-9.]+rem$/.test(wRem)) return `w-[${wRem}]`;
  const wPx = String(getAttrValue(node.attrs, "data-w-px") || "").trim();
  if (wPx && /^[0-9.]+px$/.test(wPx)) return `w-[${wPx}]`;
  return null;
};

const isWidthToken = (token) => {
  const core = normalizeToken(token);
  return /^w-/.test(core) || /^max-w-/.test(core) || /^basis-/.test(core);
};

const isDecorative = (node) => {
  const decorative = String(getAttrValue(node.attrs, "data-decorative") || "").trim();
  if (decorative === "1" || decorative.toLowerCase() === "true") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  if (dataKey.includes("decorativebar")) return true;
  return false;
};

const isAllowedException = (node) => {
  if (!node?.attrs) return false;
  if (isMediaTag(node.tag)) return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (/hero|media|image|banner|bg/i.test(dataKey)) return true;
  const dataIntent = String(getAttrValue(node.attrs, "data-w-intent") || "");
  if (dataIntent.toLowerCase() === "fixed" && /hero|media|image|banner|bg/i.test(String(getAttrValue(node.attrs, "data-node") || ""))) {
    return true;
  }
  return false;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { enforced: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let enforced = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    const intent = String(getAttrValue(node.attrs, "data-w-intent") || "").toLowerCase();
    if (intent !== "fixed") return;
    if (isAllowedException(node)) return;

    const tokens = getClassTokens(node.attrs);
    const widthFromData = getWidthFromData(node);
    const hasConstraint = hasWidthConstraint(tokens);
    if (widthFromData && tokens.some((t) => normalizeToken(t) === widthFromData)) return;
    if (hasConstraint && !widthFromData) return;

    let cleaned = [...tokens];
    if (widthFromData && !cleaned.some((t) => normalizeToken(t) === widthFromData)) {
      cleaned.push(widthFromData);
    }

    if (widthFromData) {
      const keepWidthToken = (t) => {
        const core = normalizeToken(t);
        if (core === widthFromData) return true;
        if (String(t).includes(":") && isWidthToken(t)) return true;
        return !isWidthToken(t);
      };
      cleaned = cleaned.filter(keepWidthToken);
    }

    if (widthFromData && isDecorative(node)) {
      setClassTokens(node.attrs, node.attrOrder, cleaned);
      setAttrValue(node.attrs, node.attrOrder, "data-w-intent", "fixed");
    } else if (widthFromData) {
      setClassTokens(node.attrs, node.attrOrder, cleaned);
      setAttrValue(node.attrs, node.attrOrder, "data-w-intent", "fixed");
    } else {
      if (!cleaned.some((t) => normalizeToken(t) === "w-full")) cleaned.push("w-full");
      if (!cleaned.some((t) => normalizeToken(t) === "max-w-full")) cleaned.push("max-w-full");
      setClassTokens(node.attrs, node.attrOrder, cleaned);
      setAttrValue(node.attrs, node.attrOrder, "data-w-intent", "fill");
    }

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
      op: "enforceWidthIntent",
      value: "fixed intent normalized",
      reason: "Fixed width intent without matching width constraint",
    });
    enforced += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { enforced },
  };
};

module.exports = {
  id,
  apply,
};
