const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  removeAttr,
  setAttrValue,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "style/inline/stripRedundantInlineStyles";

const normalizeToken = (token) => String(token || "").split(":").pop();

const parseStyle = (style) => {
  const map = new Map();
  String(style || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [key, ...rest] = entry.split(":");
      if (!key) return;
      const value = rest.join(":").trim();
      map.set(key.trim().toLowerCase(), value);
    });
  return map;
};

const serializeStyle = (map) => {
  const entries = [];
  map.forEach((value, key) => {
    if (value != null && String(value).trim() !== "") {
      entries.push(`${key}: ${value}`);
    }
  });
  return entries.join("; ");
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { stripped: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let stripped = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    if (!Array.isArray(node.attrOrder)) node.attrOrder = Object.keys(node.attrs);
    const style = getAttrValue(node.attrs, "style");
    if (!style) return;

    const styleMap = parseStyle(style);
    const width = styleMap.get("width");
    const hasWidth100 = width && String(width).replace(/\s+/g, "") === "100%";

    if (!hasWidth100) return;

    styleMap.delete("width");

    const tokens = getClassTokens(node.attrs);
    const hasWFull = tokens.some((t) => normalizeToken(t) === "w-full");
    if (!hasWFull) {
      tokens.push("w-full");
      setClassTokens(node.attrs, node.attrOrder, tokens);
    }

    const serialized = serializeStyle(styleMap);
    if (serialized) {
      setAttrValue(node.attrs, node.attrOrder, "style", serialized);
    } else {
      removeAttr(node.attrs, node.attrOrder, "style");
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
      op: "styleReplace",
      value: "strip width:100%",
      reason: "Replaced inline width with w-full",
    });
    stripped += 1;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { stripped },
  };
};

module.exports = {
  id,
  apply,
};
