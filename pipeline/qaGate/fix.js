"use strict";

const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setAttrValue,
  setClassTokens,
} = require("../stage.codeit/contracts/utils/html");
const { removeTokens } = require("../stage.codeit/contracts/utilities/mutateClasses");
const { RULES } = require("./audit");

const LAYOUT_RULES = new Set([
  RULES.GRID_CHILD_REDUNDANT_WIDTH,
  RULES.GRID_CHILD_MISSING_W_FULL,
  RULES.GRID_CHILD_SELF_START,
  RULES.ROOT_PADDING_NO_RESPONSIVE_OVERRIDE,
  RULES.OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER,
]);

const FIXABLE_RULES = new Set([
  RULES.BUTTON_STRUCTURE_NO_P_IN_BUTTON,
  RULES.DIV_BUTTON_SHOULD_BE_BUTTON,
  RULES.DUPLICATE_FIXED_WIDTH_CLASSES,
  RULES.DUPLICATE_DATA_NODE_ID,
  RULES.DUPLICATE_DATA_KEY_ROOT,
  RULES.MULTIPLE_TOP_LEVEL_ROOTS,
  RULES.DUPLICATE_SIBLING_BLOCK,
  RULES.CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP,
  RULES.BUTTON_TEXT_SPAN_FIXED_WIDTH,
  RULES.BACKGROUND_INTENT_MISSING_IMAGE,
  RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER,
  ...LAYOUT_RULES,
]);

const normalizeToken = (t) => String(t || "").split(":").pop();
const W_ARBITRARY = /^w-\[(.+)\]$/;
const W_FIXED_SCALE = /^w-(?:\d+|px)$/;
const MAX_W_ARBITRARY = /^max-w-\[(.+)\]$/;
const MAX_W_ANY = /^max-w-/;
const normalizeWhitespace = (s) => String(s || "").replace(/\s+/g, " ").trim();
const responsiveConflictKey = (token) => {
  const t = String(token || "").trim();
  if (!t.includes(":")) return null;
  const sep = t.indexOf(":");
  if (sep <= 0) return null;
  const bp = t.slice(0, sep);
  const core = t.slice(sep + 1);
  if (!/^(sm|md|lg|xl|2xl|max-[^:]+)$/.test(bp)) return null;
  if (/^justify-/.test(core)) return `${bp}:justify`;
  if (/^items-/.test(core)) return `${bp}:items`;
  if (/^content-/.test(core)) return `${bp}:content`;
  return null;
};
const hasRootSignature = (node) => {
  if (!node?.attrs) return false;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").trim().toLowerCase();
  if (dataKey === "root") return true;
  const tokens = getClassTokens(node.attrs).map(normalizeToken);
  return tokens.includes("w-full") && tokens.includes("mx-auto") && tokens.some((t) => MAX_W_ANY.test(t));
};

const CLEAN_METADATA_EXACT = new Set([
  "data-node-id",
  "data-node",
  "data-key",
  "data-w-intent",
  "data-h-intent",
  "data-w-rem",
  "data-ff",
  "data-merged-from",
  "data-fill-type",
  "data-media",
]);
const CLEAN_METADATA_PREFIXES = ["data-bg-"];
const shouldStripMetadataAttr = (key) => {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return false;
  if (CLEAN_METADATA_EXACT.has(k)) return true;
  return CLEAN_METADATA_PREFIXES.some((p) => k.startsWith(p));
};

const parseHeightRem = (token) => {
  const t = normalizeToken(token);
  const rem = t.match(/^(?:h|min-h)-\[([0-9.]+)rem\]$/);
  if (rem) return Number(rem[1]);
  return null;
};

const parseHeightPx = (token) => {
  const t = normalizeToken(token);
  const px = t.match(/^(?:h|min-h)-\[([0-9.]+)px\]$/);
  if (px) return Number(px[1]);
  return null;
};

const trimNum = (n) =>
  String(Number(Number(n || 0).toFixed(6)))
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
const remFromPx = (px) => `${trimNum(Number(px) / 16)}rem`;
const pxFromRem = (rem) => `${trimNum(Number(rem) * 16)}px`;
const isHeroLikeNode = (node) => {
  if (!node?.attrs) return false;
  const role = String(getAttrValue(node.attrs, "role") || "").toLowerCase();
  if (role === "banner") return true;
  const key = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  const id = String(getAttrValue(node.attrs, "data-node") || "").toLowerCase();
  return /hero|banner/.test(key) || /hero|banner/.test(id);
};
const parseSpacingValue = (tokenCore, prefix) => {
  const bracket = tokenCore.match(new RegExp(`^${prefix}-\\[([^\\]]+)\\]$`));
  if (bracket) {
    const raw = String(bracket[1] || "").trim();
    const remMatch = raw.match(/^([0-9.]+)rem$/i);
    if (remMatch) return { rem: Number(remMatch[1]), raw };
    const pxMatch = raw.match(/^([0-9.]+)px$/i);
    if (pxMatch) return { rem: Number(pxMatch[1]) / 16, raw };
    return { rem: Number(raw), raw };
  }
  const scale = tokenCore.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (scale) {
    // Tailwind spacing scale: n -> n*0.25rem.
    return { rem: Number(scale[1]) / 4, raw: `${Number(scale[1]) / 4}rem` };
  }
  return null;
};

const hasMeaningfulTextContent = (html, node) => {
  if (!node || node.openEnd == null || node.closeStart == null) return false;
  const inner = String(html.slice(node.openEnd, node.closeStart) || "");
  const text = inner
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text.length > 0;
};

const hasGeneratorBgImageHint = (attrs) => {
  if (!attrs) return false;
  const keys = ["data-bg-url", "data-bg-image", "data-bg-mobile", "data-bg-tablet", "data-bg-desktop"];
  return keys.some((k) => String(getAttrValue(attrs, k) || "").trim().length > 0);
};

const materializeBackgroundImageFromData = (attrs, order) => {
  const candidates = [
    getAttrValue(attrs, "data-bg-url"),
    getAttrValue(attrs, "data-bg-image"),
    getAttrValue(attrs, "data-bg-desktop"),
    getAttrValue(attrs, "data-bg-tablet"),
    getAttrValue(attrs, "data-bg-mobile"),
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (!candidates.length) return false;
  const picked = candidates[0];
  const style = String(getAttrValue(attrs, "style") || "");
  if (/background-image\s*:/i.test(style)) return false;
  const bgValue = /^url\(/i.test(picked) ? picked : `url("${picked.replace(/"/g, '\\"')}")`;
  const nextStyle = (style ? style.replace(/\s*;?\s*$/, "; ") : "") + `background-image: ${bgValue};`;
  setAttrValue(attrs, order, "style", nextStyle.trim());
  return true;
};

/**
 * Apply deterministic fixes only for issues with safe autocorrect.
 * Optionally runs contract-based fixes (background fill, height removal) when artifact is provided.
 * At most one fix pass; idempotent for supported rules.
 * @param {string} html
 * @param {Array<{ id, rule, nodeIndex?, snippet? }>} issues
 * @param {{ artifact?: object, cleanMetadata?: boolean }} [opts]
 * @returns {{ fixedHtml: string, appliedFixes: Array<{ issueId, action, beforeSnippet, afterSnippet }> }}
 */
function fix(html, issues, opts = {}) {
  const source = String(html || "");
  const appliedFixes = [];
  const patches = [];
  const artifact = opts?.artifact ?? null;

  const toFix = issues.filter((i) => FIXABLE_RULES.has(i.rule) && i.nodeIndex != null);
  if (toFix.length === 0 && !artifact && !opts?.cleanMetadata) {
    return { fixedHtml: source, appliedFixes };
  }

  const nodes = parseHtmlNodes(source);
  const layoutHandled = new Set();
  const nodesRemovedByIntegrity = new Set();
  const integrityRemovals = [];

  const allIssues = Array.isArray(issues) ? issues : [];
  const hasIntegrityDup = allIssues.some((i) =>
    [
      RULES.DUPLICATE_DATA_NODE_ID,
      RULES.DUPLICATE_DATA_KEY_ROOT,
      RULES.MULTIPLE_TOP_LEVEL_ROOTS,
      RULES.DUPLICATE_SIBLING_BLOCK,
    ].includes(i.rule)
  );

  // Pre-compute safe duplicate removals first. Any node removed here must be skipped by
  // layout/class fixes to avoid overlapping patches on the same original coordinates.
  if (hasIntegrityDup) {
    const seenRemovalStart = new Set();
    const parents = new Map();
    nodes.forEach((node, idx) => {
      const parent = node.parentIndex == null ? "__root__" : String(node.parentIndex);
      if (!parents.has(parent)) parents.set(parent, []);
      parents.get(parent).push(idx);
    });

    parents.forEach((idxs) => {
      for (let i = 1; i < idxs.length; i += 1) {
        const prevIdx = idxs[i - 1];
        const curIdx = idxs[i];
        const prev = nodes[prevIdx];
        const cur = nodes[curIdx];
        if (!prev || !cur) continue;
        const prevStart = prev.start ?? prev.openStart;
        const prevEnd = prev.end ?? prev.openEnd;
        const curStart = cur.start ?? cur.openStart;
        const curEnd = cur.end ?? cur.openEnd;
        if (prevStart == null || prevEnd == null || curStart == null || curEnd == null) continue;
        if (seenRemovalStart.has(curStart)) continue;
        if (source.slice(prevEnd, curStart).trim() !== "") continue;

        const prevOuter = source.slice(prevStart, prevEnd);
        const curOuter = source.slice(curStart, curEnd);
        if (!prevOuter || !curOuter) continue;
        if (normalizeWhitespace(prevOuter) !== normalizeWhitespace(curOuter)) continue;

        const prevNodeId = String(getAttrValue(prev.attrs, "data-node-id") || "").trim();
        const curNodeId = String(getAttrValue(cur.attrs, "data-node-id") || "").trim();
        const prevKey = String(getAttrValue(prev.attrs, "data-key") || "").trim().toLowerCase();
        const curKey = String(getAttrValue(cur.attrs, "data-key") || "").trim().toLowerCase();
        const sameNodeId = prevNodeId && curNodeId && prevNodeId === curNodeId;
        const bothRootKey = prevKey === "root" && curKey === "root";
        const bothRootSignature = hasRootSignature(prev) && hasRootSignature(cur);
        if (!sameNodeId && !bothRootKey && !bothRootSignature) continue;

        seenRemovalStart.add(curStart);
        nodesRemovedByIntegrity.add(curIdx);
        integrityRemovals.push({
          nodeIndex: curIdx,
          start: curStart,
          end: curEnd,
          beforeSnippet: curOuter.slice(0, 120),
        });
      }
    });
  }

  // Apply layout rules (grid-child width, root padding, overflow-hidden) in one merged pass per node
  // so we never mutate the same node twice and only emit one patch per node.
  const layoutIssues = toFix.filter((i) => LAYOUT_RULES.has(i.rule));
  const byNode = new Map();
  layoutIssues.forEach((issue) => {
    const idx = issue.nodeIndex;
    if (!byNode.has(idx)) byNode.set(idx, []);
    byNode.get(idx).push(issue);
  });
  byNode.forEach((nodeIssues, nodeIndex) => {
    if (nodesRemovedByIntegrity.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node?.attrs) return;
    const attrsCopy = { ...node.attrs };
    const orderCopy = [...(node.attrOrder || Object.keys(node.attrs))];
    let didChange = false;
    const localFixIndices = [];
    nodeIssues.forEach((issue) => {
      if (issue.rule === RULES.GRID_CHILD_REDUNDANT_WIDTH) {
        const tokens = getClassTokens(attrsCopy);
        const wArbitrary = tokens.find((t) => W_ARBITRARY.test(normalizeToken(t)));
        if (wArbitrary) {
          const toRemove = (t) => W_ARBITRARY.test(normalizeToken(t));
          const { cleaned, removed } = removeTokens(tokens, toRemove);
          if (removed.length) {
            setClassTokens(attrsCopy, orderCopy, cleaned);
            didChange = true;
            appliedFixes.push({
              issueId: issue.id,
              action: "remove-grid-child-w-arbitrary",
              beforeSnippet: source.slice(node.openStart, node.openEnd),
              afterSnippet: "",
            });
            localFixIndices.push(appliedFixes.length - 1);
            layoutHandled.add(`${nodeIndex}:${issue.rule}`);
          }
        }
      } else if (issue.rule === RULES.GRID_CHILD_MISSING_W_FULL) {
        const tokens = getClassTokens(attrsCopy);
        const normalized = tokens.map(normalizeToken);
        const hasMaxWFull = normalized.includes("max-w-full");
        const hasAnyWidth = normalized.some((t) => t === "w-full" || W_ARBITRARY.test(t) || W_FIXED_SCALE.test(t));
        if (hasMaxWFull && !hasAnyWidth) {
          const insertAt = normalized.indexOf("max-w-full");
          const next = [...tokens];
          if (insertAt >= 0) next.splice(insertAt, 0, "w-full");
          else next.push("w-full");
          setClassTokens(attrsCopy, orderCopy, next);
          didChange = true;
          appliedFixes.push({
            issueId: issue.id,
            action: "add-grid-child-w-full",
            beforeSnippet: source.slice(node.openStart, node.openEnd),
            afterSnippet: "",
          });
          localFixIndices.push(appliedFixes.length - 1);
          layoutHandled.add(`${nodeIndex}:${issue.rule}`);
        }
      } else if (issue.rule === RULES.GRID_CHILD_SELF_START) {
        const tokens = getClassTokens(attrsCopy);
        const cleaned = tokens.filter((t) => normalizeToken(t) !== "self-start");
        if (cleaned.length < tokens.length) {
          setClassTokens(attrsCopy, orderCopy, cleaned);
          didChange = true;
          appliedFixes.push({
            issueId: issue.id,
            action: "remove-grid-child-self-start",
            beforeSnippet: source.slice(node.openStart, node.openEnd),
            afterSnippet: "",
          });
          localFixIndices.push(appliedFixes.length - 1);
          layoutHandled.add(`${nodeIndex}:${issue.rule}`);
        }
      } else if (issue.rule === RULES.ROOT_PADDING_NO_RESPONSIVE_OVERRIDE) {
        const tokens = getClassTokens(attrsCopy);
        const basePtToken = tokens.find((t) => /^pt-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pt-\d+$/.test(normalizeToken(t)));
        const basePbToken = tokens.find((t) => /^pb-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pb-\d+$/.test(normalizeToken(t)));
        let originalPt = "5rem";
        let originalPb = "5rem";
        const nodeIsHero = isHeroLikeNode(node);
        let warnedLargePadding = false;
        if (basePtToken) {
          const core = normalizeToken(basePtToken);
          const parsed = parseSpacingValue(core, "pt");
          if (parsed && Number.isFinite(parsed.rem)) {
            if (!nodeIsHero && parsed.rem > 16) {
              originalPt = pxFromRem(parsed.rem);
              warnedLargePadding = true;
            }
            else originalPt = remFromPx(parsed.rem * 16);
          }
        }
        if (basePbToken) {
          const core = normalizeToken(basePbToken);
          const parsed = parseSpacingValue(core, "pb");
          if (parsed && Number.isFinite(parsed.rem)) {
            if (!nodeIsHero && parsed.rem > 16) {
              originalPb = pxFromRem(parsed.rem);
              warnedLargePadding = true;
            }
            else originalPb = remFromPx(parsed.rem * 16);
          }
        }
        const isPtBase = (t) => /^pt-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pt-\d+$/.test(normalizeToken(t));
        const isPbBase = (t) => /^pb-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pb-\d+$/.test(normalizeToken(t));
        const withoutBasePtPb = tokens.filter((t) => !isPtBase(t) && !isPbBase(t));
        const next = [
          ...withoutBasePtPb,
          "pt-[2.5rem]",
          "pb-[2.5rem]",
          "md:pt-[" + originalPt + "]",
          "md:pb-[" + originalPb + "]",
        ];
        setClassTokens(attrsCopy, orderCopy, next);
        didChange = true;
        appliedFixes.push({
          issueId: issue.id,
          action: "root-padding-responsive-override",
          beforeSnippet: source.slice(node.openStart, node.openEnd),
          afterSnippet: "",
        });
        if (warnedLargePadding) {
          appliedFixes.push({
            issueId: issue.id,
            action: "root-padding-large-nonhero-warning",
            beforeSnippet: source.slice(node.openStart, node.openEnd),
            afterSnippet: "md padding kept as px bracket due >16rem non-hero value",
          });
        }
        localFixIndices.push(appliedFixes.length - 1);
        layoutHandled.add(`${nodeIndex}:${issue.rule}`);
      } else if (issue.rule === RULES.OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER) {
        const tokens = getClassTokens(attrsCopy);
        const cleaned = tokens.filter((t) => normalizeToken(t) !== "overflow-hidden");
        if (cleaned.length < tokens.length) {
          setClassTokens(attrsCopy, orderCopy, cleaned);
          didChange = true;
          appliedFixes.push({
            issueId: issue.id,
            action: "remove-overflow-hidden",
            beforeSnippet: source.slice(node.openStart, node.openEnd),
            afterSnippet: "",
          });
          localFixIndices.push(appliedFixes.length - 1);
          layoutHandled.add(`${nodeIndex}:${issue.rule}`);
        }
      }
    });
    if (didChange) {
      const newOpen = buildOpenTag(node.tag, attrsCopy, orderCopy, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      localFixIndices.forEach((idx) => {
        if (appliedFixes[idx] && appliedFixes[idx].afterSnippet === "") {
          appliedFixes[idx].afterSnippet = newOpen.slice(0, 120);
        }
      });
    }
  });

  toFix.forEach((issue) => {
    if (nodesRemovedByIntegrity.has(issue.nodeIndex)) return;
    if (layoutHandled.has(`${issue.nodeIndex}:${issue.rule}`)) return;

    if (issue.rule === RULES.BUTTON_STRUCTURE_NO_P_IN_BUTTON) {
      const node = nodes[issue.nodeIndex];
      if (!node || (node.tag || "").toLowerCase() !== "p") return;

      const openTag = source.slice(node.openStart, node.openEnd);
      const closeTag =
        node.closeStart != null && node.closeEnd != null
          ? source.slice(node.closeStart, node.closeEnd)
          : "";

      const newOpen = openTag.replace(/^<p(\s|\/|>)/i, "<span$1");
      const newClose = closeTag.replace(/<\/p\s*>/i, "</span>");

      if (newOpen !== openTag) {
        patches.push(createPatch(node.openStart, node.openEnd, newOpen));
        appliedFixes.push({
          issueId: issue.id,
          action: "replace-p-with-span",
          beforeSnippet: openTag,
          afterSnippet: newOpen,
        });
      }
      if (closeTag && newClose !== closeTag) {
        patches.push(createPatch(node.closeStart, node.closeEnd, newClose));
        appliedFixes.push({
          issueId: issue.id,
          action: "replace-closing-p-with-span",
          beforeSnippet: closeTag,
          afterSnippet: newClose,
        });
      }
      return;
    }

    if (issue.rule === RULES.DIV_BUTTON_SHOULD_BE_BUTTON) {
      const node = nodes[issue.nodeIndex];
      if (!node || (node.tag || "").toLowerCase() !== "div") return;

      const attrs = { ...node.attrs };
      const order = [...(node.attrOrder || Object.keys(node.attrs))];
      if (!("type" in attrs)) {
        setAttrValue(attrs, order, "type", "button");
      } else if (attrs.type == null || String(attrs.type).trim() === "") {
        attrs.type = "button";
      }

      const newOpen = buildOpenTag("button", attrs, order, false);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "div-to-button",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });

      const closeTag =
        node.closeStart != null && node.closeEnd != null
          ? source.slice(node.closeStart, node.closeEnd)
          : "";
      if (closeTag) {
        patches.push(createPatch(node.closeStart, node.closeEnd, "</button>"));
        appliedFixes.push({
          issueId: issue.id,
          action: "div-close-to-button-close",
          beforeSnippet: closeTag,
          afterSnippet: "</button>",
        });
      }
      return;
    }

    if (issue.rule === RULES.DUPLICATE_FIXED_WIDTH_CLASSES) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;

      const tokens = getClassTokens(node.attrs);
      const wFull = tokens.some((t) => normalizeToken(t) === "w-full");
      const wArbitrary = tokens.find((t) => W_ARBITRARY.test(normalizeToken(t)));
      const maxWArbitrary = tokens.filter((t) => MAX_W_ARBITRARY.test(normalizeToken(t)));
      if (!wFull || !wArbitrary || !maxWArbitrary.length) return;

      const wVal = normalizeToken(wArbitrary).match(W_ARBITRARY)?.[1];
      const hasMatchingMax = maxWArbitrary.some((t) => normalizeToken(t).match(MAX_W_ARBITRARY)?.[1] === wVal);
      if (!hasMatchingMax) return;

      const toRemove = (t) => {
        const core = normalizeToken(t);
        return W_ARBITRARY.test(core) && core.match(W_ARBITRARY)?.[1] === wVal;
      };
      const { cleaned, removed } = removeTokens(tokens, toRemove);
      if (removed.length === 0) return;

      setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), cleaned);
      const newOpen = buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "remove-redundant-w-arbitrary",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.GRID_CHILD_REDUNDANT_WIDTH) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;
      const tokens = getClassTokens(node.attrs);
      const wArbitrary = tokens.find((t) => W_ARBITRARY.test(normalizeToken(t)));
      if (!wArbitrary) return;
      const toRemove = (t) => W_ARBITRARY.test(normalizeToken(t));
      const { cleaned, removed } = removeTokens(tokens, toRemove);
      if (removed.length === 0) return;
      setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), cleaned);
      const newOpen = buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "remove-grid-child-w-arbitrary",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.ROOT_PADDING_NO_RESPONSIVE_OVERRIDE) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;
      const tokens = getClassTokens(node.attrs);
      const basePtToken = tokens.find((t) => /^pt-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pt-\d+$/.test(normalizeToken(t)));
      const basePbToken = tokens.find((t) => /^pb-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pb-\d+$/.test(normalizeToken(t)));
      let originalPt = "5rem";
      let originalPb = "5rem";
      if (basePtToken) {
        const core = normalizeToken(basePtToken);
        const m = core.match(/pt-\[([^\]]+)\]/);
        if (m) originalPt = m[1];
        else {
          const m2 = core.match(/pt-(\d+)/);
          if (m2) originalPt = m2[1] + "rem";
        }
      }
      if (basePbToken) {
        const core = normalizeToken(basePbToken);
        const m = core.match(/pb-\[([^\]]+)\]/);
        if (m) originalPb = m[1];
        else {
          const m2 = core.match(/pb-(\d+)/);
          if (m2) originalPb = m2[1] + "rem";
        }
      }
      const isPtBase = (t) => /^pt-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pt-\d+$/.test(normalizeToken(t));
      const isPbBase = (t) => /^pb-\[[^\]]+\]$/.test(normalizeToken(t)) || /^pb-\d+$/.test(normalizeToken(t));
      const withoutBasePtPb = tokens.filter((t) => !isPtBase(t) && !isPbBase(t));
      const next = [
        ...withoutBasePtPb,
        "pt-[2.5rem]",
        "pb-[2.5rem]",
        "md:pt-[" + originalPt + "]",
        "md:pb-[" + originalPb + "]",
      ];
      setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), next);
      const newOpen = buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "root-padding-responsive-override",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;
      const tokens = getClassTokens(node.attrs);
      const cleaned = tokens.filter((t) => normalizeToken(t) !== "overflow-hidden");
      if (cleaned.length === tokens.length) return;
      setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), cleaned);
      const newOpen = buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "remove-overflow-hidden",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;
      const tokens = getClassTokens(node.attrs);
      if (!tokens.length) return;

      const lastIdxByKey = new Map();
      tokens.forEach((tok, idx) => {
        const key = responsiveConflictKey(tok);
        if (!key) return;
        lastIdxByKey.set(key, idx);
      });

      const cleaned = tokens.filter((tok, idx) => {
        const key = responsiveConflictKey(tok);
        if (!key) return true;
        const lastIdx = lastIdxByKey.get(key);
        if (lastIdx == null) return true;
        return idx === lastIdx;
      });

      if (cleaned.length === tokens.length) return;
      setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), cleaned);
      const newOpen = buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "remove-conflicting-responsive-utility",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.BUTTON_TEXT_SPAN_FIXED_WIDTH) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs || (node.tag || "").toLowerCase() !== "span") return;
      const parent = node.parentIndex != null ? nodes[node.parentIndex] : null;
      if (!parent || (parent.tag || "").toLowerCase() !== "button") return;
      const tokens = getClassTokens(node.attrs);
      const cleaned = tokens.filter((t) => {
        const core = normalizeToken(t);
        if (core === "w-full") return true;
        return !(W_ARBITRARY.test(core) || W_FIXED_SCALE.test(core));
      });
      if (cleaned.length === tokens.length) return;
      setClassTokens(node.attrs, node.attrOrder || Object.keys(node.attrs), cleaned);
      const newOpen = buildOpenTag(node.tag, node.attrs, node.attrOrder || Object.keys(node.attrs), node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "remove-button-text-fixed-width",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.BACKGROUND_INTENT_MISSING_IMAGE) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;
      const attrs = { ...node.attrs };
      const order = [...(node.attrOrder || Object.keys(node.attrs))];
      const beforeOpen = source.slice(node.openStart, node.openEnd);
      let changed = false;

      if (hasGeneratorBgImageHint(attrs)) {
        changed = materializeBackgroundImageFromData(attrs, order) || changed;
      }

      if (!changed) {
        const tokens = getClassTokens(attrs);
        const cleaned = tokens.filter((t) => {
          const core = normalizeToken(t);
          return core !== "bg-cover" && core !== "bg-no-repeat" && core !== "bg-center";
        });
        if (cleaned.length < tokens.length) {
          setClassTokens(attrs, order, cleaned);
          changed = true;
        }
      }

      if (!changed) return;
      const newOpen = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "resolve-background-intent-missing-image",
        beforeSnippet: beforeOpen,
        afterSnippet: newOpen,
      });
      return;
    }

    if (issue.rule === RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER) {
      const node = nodes[issue.nodeIndex];
      if (!node?.attrs) return;
      const attrs = { ...node.attrs };
      const order = [...(node.attrOrder || Object.keys(node.attrs))];
      const tokens = getClassTokens(attrs);
      const remHeights = tokens.map(parseHeightRem).filter((n) => Number.isFinite(n));
      const pxHeights = tokens.map(parseHeightPx).filter((n) => Number.isFinite(n));
      const hasSmallHeight = remHeights.some((n) => n <= 1) || pxHeights.some((n) => n <= 16);
      const hasText = hasMeaningfulTextContent(source, node);
      const dataKey = String(getAttrValue(attrs, "data-key") || "").toLowerCase();
      const decorativeKey = /decorativebarhorizontal/.test(dataKey);
      const looksDecorative = (hasSmallHeight && !hasText) || decorativeKey;

      if (looksDecorative) {
        setAttrValue(attrs, order, "data-decorative", "1");
        const newOpen = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
        patches.push(createPatch(node.openStart, node.openEnd, newOpen));
        appliedFixes.push({
          issueId: issue.id,
          action: "mark-decorative-height-wrapper",
          beforeSnippet: source.slice(node.openStart, node.openEnd),
          afterSnippet: newOpen,
        });
        return;
      }

      const cleaned = tokens.filter((t) => {
        const core = normalizeToken(t);
        const rem = parseHeightRem(core);
        const px = parseHeightPx(core);
        if (Number.isFinite(rem)) return rem <= 1;
        if (Number.isFinite(px)) return px <= 16;
        if (/^h-\[.+\]$/.test(core)) return false;
        return true;
      });
      if (cleaned.length === tokens.length) return;
      setClassTokens(attrs, order, cleaned);
      const newOpen = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      patches.push(createPatch(node.openStart, node.openEnd, newOpen));
      appliedFixes.push({
        issueId: issue.id,
        action: "remove-large-wrapper-fixed-height",
        beforeSnippet: source.slice(node.openStart, node.openEnd),
        afterSnippet: newOpen,
      });
      return;
    }

    if (
      issue.rule === RULES.DUPLICATE_DATA_NODE_ID ||
      issue.rule === RULES.DUPLICATE_DATA_KEY_ROOT ||
      issue.rule === RULES.MULTIPLE_TOP_LEVEL_ROOTS ||
      issue.rule === RULES.DUPLICATE_SIBLING_BLOCK
    ) {
      // handled by safe duplicate sibling pass below
      return;
    }
  });

  integrityRemovals.forEach((rm) => {
    patches.push(createPatch(rm.start, rm.end, ""));
    appliedFixes.push({
      issueId: "qa-integrity-safe-dedupe",
      action: "remove-immediate-identical-duplicate",
      beforeSnippet: rm.beforeSnippet,
      afterSnippet: "",
    });
  });

  let fixedHtml = applyPatches(source, patches);

  if (artifact) {
    const hasBackgroundIntent = issues.some((i) => i.rule === RULES.BACKGROUND_INTENT_MISSING_IMAGE);
    const hasHeightIntent = issues.some((i) => i.rule === RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER);

    if (hasHeightIntent) {
      try {
        const removeArbitrary = require("../stage.codeit/contracts/layout/height/removeArbitraryWrapperHeights");
        const out = removeArbitrary.apply({ html: fixedHtml });
        if (out?.html != null) {
          fixedHtml = out.html;
          (out.changes || []).forEach((ch) => {
            appliedFixes.push({
              issueId: "qa-contract-height",
              action: "removeArbitraryWrapperHeights",
              beforeSnippet: ch.value || "",
              afterSnippet: "removed",
            });
          });
        }
      } catch (_) {
        // contract not available or failed
      }
    }

    if (hasBackgroundIntent) {
      try {
        const applyBg = require("../stage.codeit/contracts/media/fill/applyBackgroundFromFigmaFill");
        const out = applyBg.apply({ html: fixedHtml, artifact });
        if (out?.html != null) {
          fixedHtml = out.html;
          (out.changes || []).slice(0, 5).forEach((ch) => {
            appliedFixes.push({
              issueId: "qa-contract-bg",
              action: "applyBackgroundFromFigmaFill",
              beforeSnippet: "",
              afterSnippet: ch?.value || "background-image applied",
            });
          });
        }
      } catch (_) {
        // contract not available or failed
      }
    }
  }

  if (opts?.cleanMetadata) {
    const cleanNodes = parseHtmlNodes(fixedHtml);
    const cleanPatches = [];
    let strippedAttrsCount = 0;
    cleanNodes.forEach((node) => {
      if (!node?.attrs) return;
      const attrs = { ...node.attrs };
      const order = [...(node.attrOrder || Object.keys(node.attrs))].filter((k) => !shouldStripMetadataAttr(k));
      let changed = false;
      Object.keys(attrs).forEach((k) => {
        if (!shouldStripMetadataAttr(k)) return;
        delete attrs[k];
        strippedAttrsCount += 1;
        changed = true;
      });

      if (!changed) return;
      const newOpen = buildOpenTag(node.tag, attrs, order, node.isSelfClosing);
      cleanPatches.push(createPatch(node.openStart, node.openEnd, newOpen));
    });
    if (cleanPatches.length) {
      fixedHtml = applyPatches(fixedHtml, cleanPatches);
      appliedFixes.push({
        issueId: "qa-clean-metadata",
        action: "strip-design-metadata",
        beforeSnippet: "",
        afterSnippet: `updated ${cleanPatches.length} node(s), stripped ${strippedAttrsCount} metadata attribute(s)`,
      });
    }
  }

  return { fixedHtml, appliedFixes };
}

module.exports = { fix, FIXABLE_RULES };
