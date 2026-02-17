const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/section/responsiveHorizontalPadding";

const LAYOUT_TAGS = new Set(["section", "div", "header", "main", "nav", "article"]);

const normalizeToken = (token) => String(token || "").split(":").pop();

const getPrefix = (token) => {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(":");
};

const isTopLevelLayoutWrapper = (node, nodes) => {
  if (!node?.attrs) return false;
  if (!LAYOUT_TAGS.has(String(node.tag || "").toLowerCase())) return false;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (dataKey === "root") return true;
  const hasDataWRem = Boolean(String(getAttrValue(node.attrs, "data-w-rem") || "").trim());
  const ownTokens = getClassTokens(node.attrs).map(normalizeToken);
  const hasOwnMaxWContext = ownTokens.some((t) => /^max-w-/.test(t));
  if (!hasDataWRem && !hasOwnMaxWContext) return false;
  const parentIndex = node.parentIndex;
  if (parentIndex == null) return true;
  const parent = nodes[parentIndex];
  const parentTag = String(parent?.tag || "").toLowerCase();
  if (parentTag === "body" || parentTag === "section" || parentTag === "main" || parentTag === "header") {
    return true;
  }
  const parentTokens = getClassTokens(parent?.attrs || {}).map(normalizeToken);
  return parentTokens.includes("mx-auto") || parentTokens.some((t) => /^max-w-/.test(t));
};

const isFixedHorizontalPaddingCore = (core) =>
  /^p[lr]-20$/.test(core) || /^p[lr]-\[[^\]]+\]$/.test(core) || /^px-20$/.test(core) || /^px-\[[^\]]+\]$/.test(core);

const hasMdHorizontalPadding = (tokens) =>
  tokens.some((t) => getPrefix(t) === "md" && /^p[lrx]-/.test(normalizeToken(t)));

const getBaseToken = (tokens, matcher) => {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (getPrefix(token) !== "") continue;
    if (matcher(normalizeToken(token))) return token;
  }
  return null;
};

const equivalentSymmetricPair = (plToken, prToken) => {
  if (!plToken || !prToken) return false;
  const plCore = normalizeToken(plToken);
  const prCore = normalizeToken(prToken);
  const left = plCore.replace(/^pl-/, "");
  const right = prCore.replace(/^pr-/, "");
  return left === right && (left === "20" || /^\[[^\]]+\]$/.test(left));
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { adjusted: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  let adjusted = 0;

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;
    if (!isTopLevelLayoutWrapper(node, nodes)) return;

    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;

    const hasMd = hasMdHorizontalPadding(tokens);
    const basePx = getBaseToken(tokens, (core) => /^px-/.test(core));
    const basePl = getBaseToken(tokens, (core) => /^pl-/.test(core));
    const basePr = getBaseToken(tokens, (core) => /^pr-/.test(core));

    const hasSymmetricFixedPair = equivalentSymmetricPair(basePl, basePr);
    const hasFixedPx = Boolean(basePx && isFixedHorizontalPaddingCore(normalizeToken(basePx)));

    if (!hasFixedPx && !(hasSymmetricFixedPair && !hasMd)) return;

    let next = [...tokens];
    let changed = false;

    // Remove base horizontal padding tokens only.
    next = next.filter((token) => {
      if (getPrefix(token) !== "") return true;
      const core = normalizeToken(token);
      if (/^pl-/.test(core) || /^pr-/.test(core) || /^px-/.test(core)) {
        changed = true;
        return false;
      }
      return true;
    });

    if (!next.includes("px-5")) {
      next.push("px-5");
      changed = true;
    }

    if (!hasMd && !next.includes("md:px-20")) {
      next.push("md:px-20");
      changed = true;
    }

    if (!changed) return;

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
      op: "paddingResponsive",
      value: "px-5 md:px-20",
      reason: "Patch: make horizontal padding responsive at md to restore full-width feel",
    });
    adjusted += 1;
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings: [],
    stats: { adjusted },
  };
};

module.exports = {
  id,
  apply,
};

