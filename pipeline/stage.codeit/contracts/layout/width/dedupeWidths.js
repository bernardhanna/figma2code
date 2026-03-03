const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { removeTokens } = require("../../utilities/mutateClasses");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/width/dedupeWidths";

const WIDTH_TOKEN = /^(w-|min-w-|max-w-).+/;
const LEGACY_WIDTH_TOKEN = /^w-\[[^\]]+\]$/;
const ARBITRARY_REM_WIDTH = /^(w|max-w)-\[([0-9]+(?:\.[0-9]+)?)rem\]$/;
const CONTAINER_TAGS = new Set(["div", "section", "main", "article", "header", "aside", "nav"]);
const MEDIA_TAGS = new Set(["img", "picture", "video", "canvas", "svg", "iframe"]);

const parseToken = (token) => {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const parts = raw.split(":");
  const core = String(parts.pop() || "");
  const prefix = parts.join(":");
  if (!WIDTH_TOKEN.test(core)) return null;
  let family = "";
  if (core.startsWith("min-w-")) family = "min-w";
  else if (core.startsWith("max-w-")) family = "max-w";
  else family = "w";
  return {
    token: raw,
    prefix,
    core,
    family,
    isArbitrary: /\[[^\]]+\]/.test(core),
    isFull: core === "w-full" || core === "max-w-full" || core === "min-w-full",
    rem: (() => {
      const m = core.match(ARBITRARY_REM_WIDTH);
      return m ? Number(m[2]) : null;
    })(),
  };
};

const isWidthToken = (token) => WIDTH_TOKEN.test(String(token || "").split(":").pop());
const isLegacyWidthToken = (token) => LEGACY_WIDTH_TOKEN.test(String(token || "").split(":").pop());

const hasWidthControl = (tokens) =>
  tokens.some((token) => {
    const core = String(token || "").split(":").pop();
    return core === "w-full" || core === "w-screen" || isWidthToken(core);
  });

const hasMaxWFull = (tokens) =>
  tokens.some((token) => String(token || "").split(":").pop() === "max-w-full");

const getCore = (token) => String(token || "").split(":").pop();

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const p = node?.parentIndex;
    if (p === null || p === undefined) return;
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(index);
  });
  return map;
};

const hasMediaDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (MEDIA_TAGS.has(String(node.tag || "").toLowerCase())) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

const ancestorHasCanonicalContainerConstraint = (nodes, node, remValue) => {
  if (!Number.isFinite(remValue) || remValue <= 0) return false;
  const remToken = `max-w-[${remValue}rem]`;
  let p = node?.parentIndex;
  let sawWFull = false;
  let sawMxAuto = false;
  let sawMaxW = false;
  while (p !== null && p !== undefined && nodes[p]) {
    const tokens = getClassTokens(nodes[p].attrs || []).map((token) => getCore(token));
    if (tokens.includes("w-full")) sawWFull = true;
    if (tokens.includes("mx-auto")) sawMxAuto = true;
    if (tokens.includes(remToken)) sawMaxW = true;
    p = nodes[p].parentIndex;
  }
  return sawWFull && sawMxAuto && sawMaxW;
};

const REASON = "Resolved conflicting Tailwind class token(s)";

const remFromDataWRem = (node) => {
  const raw = String(getAttrValue(node?.attrs, "data-w-rem") || "").trim().toLowerCase();
  if (!raw) return null;
  const rem = raw.match(/^(\d+(?:\.\d+)?)rem$/);
  if (rem) return Number(rem[1]);
  const px = raw.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]) / 16;
  const num = raw.match(/^(\d+(?:\.\d+)?)$/);
  if (num) return Number(num[1]);
  return null;
};

const pickWinner = (items) => {
  if (!Array.isArray(items) || !items.length) return null;
  if (items.length === 1) return items[0];
  const family = items[0].family;
  const arbitrary = items.filter((x) => x.isArbitrary);
  if (arbitrary.length) return arbitrary[0];
  if (family === "max-w") {
    const nonFull = items.find((x) => !x.isFull);
    return nonFull || items[0];
  }
  if (family === "w") {
    const explicit = items.find((x) => x.core !== "w-full");
    return explicit || items[0];
  }
  return items[0];
};

const hasPatchOps = (ops) => {
  const obj = ops && typeof ops === "object" ? ops : {};
  return (
    (Array.isArray(obj.classRemove) && obj.classRemove.length > 0) ||
    (obj.classReplace && Object.keys(obj.classReplace).length > 0)
  );
};

const proposePatchOps = ({ tokens, isWrapper = false } = {}) => {
  const list = Array.isArray(tokens) ? tokens : [];
  const widthItems = list.map(parseToken).filter(Boolean);
  if (widthItems.length < 2) return null;

  const byScopeFamily = new Map();
  widthItems.forEach((item) => {
    const key = `${item.prefix}|${item.family}`;
    if (!byScopeFamily.has(key)) byScopeFamily.set(key, []);
    byScopeFamily.get(key).push(item);
  });

  const remove = [];
  byScopeFamily.forEach((items) => {
    if (!items || items.length < 2) return;
    const family = items[0].family;
    let winner = pickWinner(items);
    if (family === "w" && isWrapper) {
      const byPrefix = widthItems.filter((x) => x.prefix === items[0].prefix);
      const hasWFull = items.some((x) => x.core === "w-full");
      const maxRems = new Set(
        byPrefix
          .filter((x) => x.family === "max-w" && Number.isFinite(x.rem))
          .map((x) => x.rem)
      );
      const matchingFixed = items.find((x) => Number.isFinite(x.rem) && maxRems.has(x.rem));
      if (hasWFull && matchingFixed) {
        winner = items.find((x) => x.core === "w-full") || winner;
      }
    }
    if (!winner) return;
    const losers = items.filter((x) => x.token !== winner.token);
    if (!losers.length) return;

    // Keep max-w-full if it's the only max-w token.
    if (family === "max-w") {
      const maxw = items;
      if (maxw.length === 1 && maxw[0].core === "max-w-full") return;
      if (isWrapper && maxw.length === 1) return;
    }
    // Keep w-full if removing it leaves no width token in the same scope.
    if (family === "w") {
      const remaining = items.filter((x) => x.token === winner.token);
      if (!remaining.length) return;
    }
    losers.forEach((x) => remove.push(x.token));
  });

  const classRemove = Array.from(new Set(remove.filter(Boolean)));
  const ops = { classRemove, classReplace: {} };
  return hasPatchOps(ops) ? ops : null;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);
  const patches = [];
  const changes = [];
  const warnings = [];
  let removed = 0;

  nodes.forEach((node, index) => {
    if (!node?.attrs) return;
    if (node.parentIndex === null || node.parentIndex === undefined) return;

    const parent = nodes[node.parentIndex];
    if (!parent?.attrs) return;

    const tokens = getClassTokens(node.attrs);
    const parentTokens = getClassTokens(parent.attrs);
    if (!tokens.length || !parentTokens.length) return;

    const nodeTag = String(node.tag || "").toLowerCase();
    const isContainerLike = CONTAINER_TAGS.has(nodeTag);
    const mediaLike = MEDIA_TAGS.has(nodeTag) || hasMediaDescendant(nodes, childrenMap, index);

    const widthItems = tokens.map(parseToken).filter(Boolean);
    const wRemItems = widthItems.filter((item) => item.family === "w" && Number.isFinite(item.rem));
    const maxRemItems = widthItems.filter((item) => item.family === "max-w" && Number.isFinite(item.rem));
    const hasWFull = tokens.some((token) => getCore(token) === "w-full");

    // Prefer explicit data-w-rem intent when conflicting arbitrary width tokens exist.
    const preferredRem = remFromDataWRem(node);
    if (Number.isFinite(preferredRem) && wRemItems.length === 1) {
      const current = wRemItems[0];
      if (current.rem !== preferredRem) {
        const preferredToken = `${current.prefix ? `${current.prefix}:` : ""}w-[${preferredRem}rem]`;
        const cleaned = tokens.map((token) => (token === current.token ? preferredToken : token));
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
          value: `${current.token} -> ${preferredToken}`,
          reason: "Preferred width token matching data-w-rem intent",
        });
        removed += 1;
        return;
      }
    }

    if (Number.isFinite(preferredRem) && wRemItems.length > 1) {
      const matches = wRemItems.filter((item) => item.rem === preferredRem);
      if (matches.length === 1) {
        const preferred = matches[0];
        const removable = wRemItems.filter((item) => item.token !== preferred.token);
        if (removable.length) {
          const cleaned = tokens.filter((token) => !removable.some((item) => item.token === token));
          setClassTokens(node.attrs, node.attrOrder, cleaned);
          patches.push(
            createPatch(
              node.openStart,
              node.openEnd,
              buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
            )
          );
          const meta = getNodeMeta(node);
          removable.forEach((item) => {
            changes.push({
              contractId: id,
              nodeId: meta.nodeId,
              selector: meta.selector,
              op: "classRemove",
              value: item.token,
              reason: "Preferred width token matching data-w-rem intent",
            });
          });
          removed += removable.length;
          return;
        }
      }
    }

    // Canonical container: if node has both w-[Xrem] and max-w-[Xrem], prefer w-full + max-w-[Xrem]
    if (!mediaLike && wRemItems.length && maxRemItems.length) {
      const matching = wRemItems.find((wItem) => maxRemItems.some((mItem) => mItem.rem === wItem.rem));
      if (matching) {
        const cleaned = tokens.filter((token) => token !== matching.token);
        if (!hasWFull) cleaned.push("w-full");
        setClassTokens(node.attrs, node.attrOrder, cleaned);
        patches.push(
          createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing))
        );
        const meta = getNodeMeta(node);
        changes.push({
          contractId: id,
          nodeId: meta.nodeId,
          selector: meta.selector,
          op: "classRemove",
          value: matching.token,
          reason: "Canonical container width: prefer w-full + max-w-[Xrem]",
        });
        if (!hasWFull) {
          changes.push({
            contractId: id,
            nodeId: meta.nodeId,
            selector: meta.selector,
            op: "classAdd",
            value: "w-full",
            reason: "Canonical container width: add fluid width baseline",
          });
        }
        removed += 1;
        return;
      }
    }

    // Ancestor-aware pruning for container-constrained descendants.
    if (!mediaLike && (wRemItems.length || maxRemItems.length)) {
      const targetRem = (wRemItems[0] && wRemItems[0].rem) || (maxRemItems[0] && maxRemItems[0].rem);
      if (ancestorHasCanonicalContainerConstraint(nodes, node, targetRem)) {
        const removable = [];
        if (wRemItems.length && isContainerLike) removable.push(...wRemItems.map((x) => x.token));
        if (maxRemItems.length) removable.push(...maxRemItems.map((x) => x.token));
        if (removable.length) {
          const cleaned = tokens.filter((token) => !removable.includes(token));
          if (wRemItems.length && isContainerLike && !cleaned.some((token) => getCore(token) === "w-full")) {
            cleaned.push("w-full");
          }
          setClassTokens(node.attrs, node.attrOrder, cleaned);
          patches.push(
            createPatch(
              node.openStart,
              node.openEnd,
              buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
            )
          );
          const meta = getNodeMeta(node);
          removable.forEach((token) => {
            changes.push({
              contractId: id,
              nodeId: meta.nodeId,
              selector: meta.selector,
              op: "classRemove",
              value: token,
              reason: "Removed redundant descendant width under canonical ancestor container",
            });
          });
          if (wRemItems.length && isContainerLike && !tokens.some((token) => getCore(token) === "w-full")) {
            changes.push({
              contractId: id,
              nodeId: meta.nodeId,
              selector: meta.selector,
              op: "classAdd",
              value: "w-full",
              reason: "Canonical descendant width: add fluid width baseline",
            });
          }
          removed += removable.length;
          return;
        }
      }
    }

    const childHasMaxWFull = hasMaxWFull(tokens);
    const childWidthTokens = tokens.filter((token) => isLegacyWidthToken(token));

    if (!childHasMaxWFull || !childWidthTokens.length) return;

    if (!hasWidthControl(parentTokens)) {
      const meta = getNodeMeta(node);
      warnings.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        message: "Skipped width dedupe: parent width control not detected.",
      });
      return;
    }

    const { cleaned, removed: removedTokens } = removeTokens(tokens, (token) =>
      childWidthTokens.includes(token)
    );
    if (!removedTokens.length) return;
    const shouldAddFluidWidthForMedia = mediaLike && !cleaned.some((token) => getCore(token) === "w-full");
    if (shouldAddFluidWidthForMedia) cleaned.push("w-full");

    setClassTokens(node.attrs, node.attrOrder, cleaned);
    patches.push(createPatch(node.openStart, node.openEnd, buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)));

    const meta = getNodeMeta(node);
    removedTokens.forEach((token) => {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classRemove",
        value: token,
        reason: REASON,
      });
    });
    if (shouldAddFluidWidthForMedia) {
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classAdd",
        value: "w-full",
        reason: "Preserve media wrapper width after removing conflicting fixed width",
      });
    }
    removed += removedTokens.length;
  });

  const output = applyPatches(source, patches);

  return {
    html: output,
    changes,
    warnings,
    stats: { removed },
  };
};

module.exports = {
  id,
  apply,
  proposePatchOps,
};
