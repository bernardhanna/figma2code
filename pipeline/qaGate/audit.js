"use strict";

const {
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
} = require("../stage.codeit/contracts/utils/html");
const { isMediaTag } = require("../stage.codeit/contracts/utilities/select");

/**
 * QA runs in PREVIEW MODE on the exact HTML string used to render the preview
 * (finalHtml from iframe body). No earlier stage artifact. Integrity rules below
 * are fatal: DUPLICATE_DATA_NODE_ID, DUPLICATE_DATA_KEY_ROOT.
 */
const RULES = {
  BUTTON_STRUCTURE_NO_P_IN_BUTTON: "BUTTON_STRUCTURE_NO_P_IN_BUTTON",
  DIV_BUTTON_SHOULD_BE_BUTTON: "DIV_BUTTON_SHOULD_BE_BUTTON",
  BACKGROUND_INTENT_MISSING_IMAGE: "BACKGROUND_INTENT_MISSING_IMAGE",
  DUPLICATE_FIXED_WIDTH_CLASSES: "DUPLICATE_FIXED_WIDTH_CLASSES",
  NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER: "NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER",
  /** PREVIEW MODE (fatal): same data-node-id appears more than once in final HTML. */
  DUPLICATE_DATA_NODE_ID: "DUPLICATE_DATA_NODE_ID",
  /** PREVIEW MODE (fatal): data-key="root" appears more than once in one section/document. */
  DUPLICATE_DATA_KEY_ROOT: "DUPLICATE_DATA_KEY_ROOT",
  DUPLICATE_DATA_KEY: "DUPLICATE_DATA_KEY",
  MULTIPLE_TOP_LEVEL_ROOTS: "MULTIPLE_TOP_LEVEL_ROOTS",
  DUPLICATE_SIBLING_BLOCK: "DUPLICATE_SIBLING_BLOCK",
  /** Grid child has w-[X] + max-w-full; parent has grid-cols-* — width should be controlled by grid. */
  GRID_CHILD_REDUNDANT_WIDTH: "GRID_CHILD_REDUNDANT_WIDTH",
  /** Grid child under grid-cols has max-w-full but no width utility; add w-full for stable cell fill. */
  GRID_CHILD_MISSING_W_FULL: "GRID_CHILD_MISSING_W_FULL",
  /** Grid child under grid-cols has self-start; remove unless explicit alignment intent is required. */
  GRID_CHILD_SELF_START: "GRID_CHILD_SELF_START",
  /** Button text span has fixed width utility; remove width and rely on button padding/layout. */
  BUTTON_TEXT_SPAN_FIXED_WIDTH: "BUTTON_TEXT_SPAN_FIXED_WIDTH",
  /** Root has pt/pb but no responsive override (design rule: 2.5rem below md, 5rem from md up). */
  ROOT_PADDING_NO_RESPONSIVE_OVERRIDE: "ROOT_PADDING_NO_RESPONSIVE_OVERRIDE",
  /** overflow-hidden on wrapper that does not directly wrap img/video and has no background video. */
  OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER: "OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER",
  /** Same breakpoint has conflicting utilities for the same property (e.g., md:justify-center + md:justify-start). */
  CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP: "CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP",
  /** Markup appears malformed (unbalanced/unmatched open/close tags). */
  UNBALANCED_HTML_TAGS: "UNBALANCED_HTML_TAGS",
  /** Structural corruption marker: escaped tag boundaries leaked into open tag text. */
  STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY: "STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY",
};

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

const getDirectChildren = (childrenMap, nodeIndex) => childrenMap.get(nodeIndex) || [];

const nodeSignature = (node) => {
  const key = getAttrValue(node?.attrs, "data-key");
  if (key) return `data-key="${key}"`;
  const id = getAttrValue(node?.attrs, "data-node-id");
  if (id) return `data-node-id="${id}"`;
  return `${node?.tag || "?"}@${node?.openStart ?? ""}`;
};

const snippet = (html, node, maxLen = 80) => {
  if (node?.openStart == null || node?.openEnd == null) return "";
  const raw = html.slice(node.openStart, node.openEnd);
  return raw.length > maxLen ? raw.slice(0, maxLen) + "\u2026" : raw;
};

let issueCounter = 0;
function makeIssue(severity, rule, message, selector, snippetText, nodeIndex = null, extra = {}) {
  issueCounter += 1;
  return {
    id: `qa-${rule}-${issueCounter}`,
    severity,
    rule,
    message,
    selector: selector || null,
    snippet: snippetText || null,
    nodeIndex: nodeIndex ?? null,
    ...extra,
  };
}

const normalizeToken = (t) => String(t || "").split(":").pop();

const isMediaSlotDataKey = (value) => {
  const key = String(value || "").toLowerCase();
  return (
    key.includes("frame:image") ||
    key.includes("frame:hero") ||
    key.includes("frame:media")
  );
};

const isFrameLikeNonButtonDataKey = (value) => {
  const key = String(value || "").toLowerCase();
  return key.includes("frame:") && !/instance:button|\/button[#/]|^button[#/:]/i.test(key);
};

const BG_IMAGE_INTENT_TOKENS = new Set(["bg-cover", "bg-contain", "bg-no-repeat", "bg-fixed"]);
const hasImageBackgroundIntentFromClasses = (tokens) =>
  tokens.some((t) => BG_IMAGE_INTENT_TOKENS.has(normalizeToken(t)) || /^bg-\[.*url\(.+\)/.test(normalizeToken(t)));

const hasBackgroundImage = (attrs) => {
  const style = getAttrValue(attrs, "style");
  if (style && /background-image\s*:/i.test(String(style))) return true;
  const tokens = getClassTokens(attrs);
  return tokens.some((t) => /^bg-\[.*url\(.+\)/.test(normalizeToken(t)));
};

const hasGeneratorBgImageHint = (attrs) => {
  if (!attrs) return false;
  const urlish = /url\(|\.(png|jpe?g|webp|gif|avif|svg|mp4|webm)(\?|$)|^https?:\/\//i;
  const bgKeys = ["data-bg-url", "data-bg-image", "data-bg-mobile", "data-bg-tablet", "data-bg-desktop"];
  const hasBgSource = bgKeys.some((k) => urlish.test(String(getAttrValue(attrs, k) || "").trim()));
  if (hasBgSource) return true;

  const mediaValue = String(getAttrValue(attrs, "data-media") || "").trim();
  if (mediaValue && urlish.test(mediaValue)) return true;

  const fillType = String(getAttrValue(attrs, "data-fill-type") || "").trim();
  // "image"/"video" alone is not enough; require a concrete source signal.
  if (/image|video/i.test(fillType) && (hasBgSource || (mediaValue && urlish.test(mediaValue)))) return true;

  return false;
};

const hasBackgroundImageIntent = (attrs) => {
  const style = String(getAttrValue(attrs, "style") || "");
  if (/background-image\s*:/i.test(style)) return true;
  const tokens = getClassTokens(attrs || {}).map(normalizeToken);
  return tokens.some((t) => /^bg-\[.*url\(/i.test(t));
};

const isAbsoluteBackgroundFillLayer = (node) => {
  if (!node?.attrs) return false;
  const tokens = getClassTokens(node.attrs).map(normalizeToken);
  const absolute = tokens.includes("absolute");
  const inset0 = tokens.includes("inset-0");
  const coverLike = tokens.includes("bg-cover") || tokens.includes("bg-contain");
  return absolute && inset0 && coverLike && hasBackgroundImageIntent(node.attrs);
};

const isDecorativeKey = (attrs) => {
  const dataKey = String(getAttrValue(attrs, "data-key") || "").toLowerCase();
  return /decorativebarhorizontal/.test(dataKey);
};

const hasDecorativeFlag = (attrs) => String(getAttrValue(attrs, "data-decorative") || "").trim() === "1";

const parseHeightRem = (token) => {
  const t = normalizeToken(token);
  const rem = t.match(/^(?:h|min-h)-\[([0-9.]+)rem\]$/);
  if (rem) return Number(rem[1]);
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

const W_ARBITRARY = /^w-\[(.+)\]$/;
const MAX_W_ARBITRARY = /^max-w-\[(.+)\]$/;
const MAX_W_ANY = /^max-w-/;
const W_FIXED_SCALE = /^w-(?:\d+|px)$/;

const BLOCK_LAYOUT_TAGS = new Set(["div", "section", "main", "article", "aside", "header", "footer", "nav"]);
const BUTTON_LIKE_CLASSES = /btn|button|cursor-pointer|hover:|focus:|active:/;

const topLevelAncestorIndex = (nodes, idx) => {
  let cur = idx;
  while (nodes[cur] && nodes[cur].parentIndex != null) cur = nodes[cur].parentIndex;
  return cur;
};

const hasRootSignature = (node) => {
  if (!node?.attrs) return false;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").trim().toLowerCase();
  if (dataKey === "root") return true;
  const tokens = getClassTokens(node.attrs).map(normalizeToken);
  const hasWFull = tokens.includes("w-full");
  const hasMxAuto = tokens.includes("mx-auto");
  const hasMaxW = tokens.some((t) => MAX_W_ANY.test(t));
  return hasWFull && hasMxAuto && hasMaxW;
};

const hasEscapedTagBoundary = (rawOpenTag) => {
  const raw = String(rawOpenTag || "");
  if (!raw) return false;
  return /&gt;\s*</i.test(raw) || /&lt;\s*\/?[a-zA-Z!]/.test(raw);
};

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

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const hasUnbalancedMarkup = (html) => {
  const src = String(html || "");
  const stack = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s+(?:[^"'<>]+|"[^"]*"|'[^']*')*)?\s*\/?>/g;
  let match;
  while ((match = tagRegex.exec(src))) {
    const raw = match[0];
    const tag = String(match[1] || "").toLowerCase();
    if (!tag) continue;
    const isClosing = raw.startsWith("</");
    const isSelfClosing = raw.endsWith("/>") || VOID_TAGS.has(tag);
    if (isClosing) {
      if (!stack.length || stack[stack.length - 1] !== tag) return true;
      stack.pop();
    } else if (!isSelfClosing) {
      stack.push(tag);
    }
  }
  return stack.length > 0;
};

/**
 * Audit HTML for QA issues. Deterministic, no AI.
 * @param {string} html
 * @returns {{ issues: Array<{id, severity, rule, message, selector?, snippet?, nodeIndex?}>, summary: { error: number, warn: number, info: number }, byRule: Record<string, number> }}
 */
function audit(html) {
  issueCounter = 0;
  const source = String(html || "");
  const issues = [];

  if (!source.trim()) {
    return {
      issues: [makeIssue("warn", "empty", "HTML is empty", null, "")],
      summary: { error: 0, warn: 1, info: 0 },
      byRule: { empty: 1 },
    };
  }

  if (/"[^"]*"\s*&gt;\s*</i.test(source) || /'[^']*'\s*&gt;\s*</i.test(source)) {
    issues.push(
      makeIssue(
        "error",
        RULES.STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY,
        "Escaped tag boundary detected between attributes and nested markup.",
        null,
        source.slice(0, 200),
        null,
        { fatal: true }
      )
    );
  }
  if (hasUnbalancedMarkup(source)) {
    issues.push(
      makeIssue(
        "error",
        RULES.UNBALANCED_HTML_TAGS,
        "Markup appears unbalanced after transforms (unmatched opening/closing tags).",
        null,
        source.slice(0, 200),
        null,
        { fatal: true }
      )
    );
  }

  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);

  nodes.forEach((node, nodeIndex) => {
    const tag = (node?.tag || "").toLowerCase();

    if (hasEscapedTagBoundary(node?.rawOpenTag)) {
      issues.push(
        makeIssue(
          "error",
          RULES.STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY,
          "Escaped tag boundary detected in open tag; HTML appears structurally corrupted.",
          nodeSignature(node),
          snippet(source, node, 200),
          nodeIndex,
          { fatal: true }
        )
      );
    }

    if (node?.attrs && Object.keys(node.attrs).some((k) => String(k).includes("&gt;") || String(k).includes("&lt;"))) {
      issues.push(
        makeIssue(
          "error",
          RULES.STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY,
          "Escaped tag marker leaked into attribute keys; HTML appears structurally corrupted.",
          nodeSignature(node),
          snippet(source, node, 200),
          nodeIndex,
          { fatal: true }
        )
      );
    }

    if (tag === "button") {
      const childIdxs = getDirectChildren(childrenMap, nodeIndex);
      childIdxs.forEach((childIdx) => {
        const child = nodes[childIdx];
        if (!child || (child.tag || "").toLowerCase() !== "p") return;
        issues.push(
          makeIssue(
            "error",
            RULES.BUTTON_STRUCTURE_NO_P_IN_BUTTON,
            "Button may not contain <p>; use <span> for phrasing content",
            nodeSignature(child),
            snippet(source, child),
            childIdx
          )
        );
      });
    }

    if (tag === "span" && node?.attrs) {
      const parent = node.parentIndex != null ? nodes[node.parentIndex] : null;
      if (parent && (parent.tag || "").toLowerCase() === "button") {
        const tokens = getClassTokens(node.attrs).map(normalizeToken);
        const hasFixedWidth = tokens.some((t) => W_ARBITRARY.test(t) || W_FIXED_SCALE.test(t));
        if (hasFixedWidth) {
          issues.push(
            makeIssue(
              "warn",
              RULES.BUTTON_TEXT_SPAN_FIXED_WIDTH,
              "Button text span has fixed width utility; remove width and rely on button padding/layout",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
      }
    }

    if (tag === "div") {
      const cls = getAttrValue(node?.attrs, "class") || "";
      const dataKey = String(getAttrValue(node?.attrs, "data-key") || "");
      if (!isMediaSlotDataKey(dataKey) && !isFrameLikeNonButtonDataKey(dataKey)) {
        const isBtnLike =
          /btn/.test(cls) || /instance:button/i.test(dataKey) || BUTTON_LIKE_CLASSES.test(cls);
        if (isBtnLike) {
          const childIdxs = getDirectChildren(childrenMap, nodeIndex);
          const hasBlockLayout = childIdxs.some((idx) => {
            const child = nodes[idx];
            const t = (child?.tag || "").toLowerCase();
            return BLOCK_LAYOUT_TAGS.has(t);
          });
          if (!hasBlockLayout) {
            issues.push(
              makeIssue(
                "error",
                RULES.DIV_BUTTON_SHOULD_BE_BUTTON,
                "Div has button styling; convert to <button type=\"button\">",
                nodeSignature(node),
                snippet(source, node),
                nodeIndex
              )
            );
          }
        }
      }
    }

    if (!isMediaTag(tag) && node?.attrs) {
      const tokens = getClassTokens(node.attrs);
      const normalized = tokens.map(normalizeToken);
      const classIntentTokens = normalized.filter(
        (x) =>
          x === "bg-cover" ||
          x === "bg-contain" ||
          x === "bg-no-repeat" ||
          x === "bg-fixed" ||
          /^bg-\[.*url\(/i.test(x)
      );
      const hasClassIntent = hasImageBackgroundIntentFromClasses(tokens);
      const hasDataIntent = hasGeneratorBgImageHint(node.attrs);
      const hasInlineImageIntent = /background-image\s*:/i.test(String(getAttrValue(node.attrs, "style") || ""));
      const hasImageIntent = hasClassIntent || hasDataIntent || hasInlineImageIntent;
      if (hasImageIntent && !hasBackgroundImage(node.attrs)) {
        issues.push(
          makeIssue(
            "warn",
            RULES.BACKGROUND_INTENT_MISSING_IMAGE,
            "Node has image-background intent but no background-image source",
            nodeSignature(node),
            snippet(source, node),
            nodeIndex,
            {
              intentSources: [
                ...(hasClassIntent ? ["class"] : []),
                ...(hasDataIntent ? ["data"] : []),
                ...(hasInlineImageIntent ? ["inline-style"] : []),
              ],
              classIntentTokens,
            }
          )
        );
      }
    }

    if (node?.attrs) {
      const tokens = getClassTokens(node.attrs);
      const wFull = tokens.some((t) => normalizeToken(t) === "w-full");
      const wArbitrary = tokens.find((t) => W_ARBITRARY.test(normalizeToken(t)));
      const maxWArbitrary = tokens.filter((t) => MAX_W_ARBITRARY.test(normalizeToken(t)));
      if (wFull && wArbitrary && maxWArbitrary.length) {
        const wMatch = normalizeToken(wArbitrary).match(W_ARBITRARY);
        const wVal = wMatch ? wMatch[1] : null;
        const maxMatch = maxWArbitrary.find((t) => {
          const m = normalizeToken(t).match(MAX_W_ARBITRARY);
          return m && m[1] === wVal;
        });
        if (maxMatch) {
          issues.push(
            makeIssue(
              "warn",
              RULES.DUPLICATE_FIXED_WIDTH_CLASSES,
              "Redundant w-[X] when w-full and max-w-[X] present",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
      }
    }

    if (tag === "div" && !isMediaTag(tag) && node?.attrs) {
      if (hasDecorativeFlag(node.attrs) || isDecorativeKey(node.attrs)) return;
      const tokens = getClassTokens(node.attrs);
      const hasArbitraryHeight = tokens.some((t) => /^h-\[.+\]$/.test(normalizeToken(t)));
      const hasMinHRem = tokens.some((t) => /^(min-h|h)-\[[0-9.]+rem\]$/.test(normalizeToken(t)));
      if (hasArbitraryHeight || hasMinHRem) {
        const smallHeight = tokens
          .map(parseHeightRem)
          .filter((v) => Number.isFinite(v))
          .some((v) => v <= 1);
        const hasText = hasMeaningfulTextContent(source, node);
        if (smallHeight && !hasText) return;
        const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
        const isMediaWrapper =
          /hero|image|media|bg|banner/i.test(dataKey) ||
          (() => {
            const queue = [...getDirectChildren(childrenMap, nodeIndex)];
            while (queue.length) {
              const idx = queue.shift();
              const n = nodes[idx];
              if (n && isMediaTag(n.tag)) return true;
              queue.push(...getDirectChildren(childrenMap, idx));
            }
            return false;
          })();
        if (!isMediaWrapper) {
          const severity = hasMinHRem ? "error" : "warn";
          issues.push(
            makeIssue(
              severity,
              RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER,
              "Non-media wrapper has fixed height; consider removing",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
      }
    }

    // GRID_CHILD_*: parent must be a grid container (has "grid" + grid-cols-*)
    const parentIdx = node.parentIndex;
    if (parentIdx != null && node?.attrs) {
      const parent = nodes[parentIdx];
      const parentTokens = parent?.attrs ? getClassTokens(parent.attrs).map(normalizeToken) : [];
      const hasGrid = parentTokens.includes("grid");
      const hasGridCols = parentTokens.some((t) => /^grid-cols-\d+$/.test(t) || /^grid-cols-\[/.test(t));
      if (hasGrid && hasGridCols) {
        const tokens = getClassTokens(node.attrs).map(normalizeToken);
        const hasWArbitrary = tokens.some((t) => W_ARBITRARY.test(t));
        const hasWFull = tokens.includes("w-full");
        const hasWFixedScale = tokens.some((t) => W_FIXED_SCALE.test(t));
        const hasMaxWFull = tokens.includes("max-w-full");
        const hasSelfStart = tokens.includes("self-start");
        if (hasWArbitrary && hasMaxWFull) {
          issues.push(
            makeIssue(
              "warn",
              RULES.GRID_CHILD_REDUNDANT_WIDTH,
              "Grid child has w-[X] and max-w-full; remove w-[X] so grid controls width",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
        if (hasMaxWFull && !hasWFull && !hasWArbitrary && !hasWFixedScale) {
          issues.push(
            makeIssue(
              "warn",
              RULES.GRID_CHILD_MISSING_W_FULL,
              "Grid child has max-w-full but no width utility; add w-full for stable cell fill",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
        if (hasSelfStart) {
          issues.push(
            makeIssue(
              "warn",
              RULES.GRID_CHILD_SELF_START,
              "Grid child has self-start; remove unless explicit alignment intent is required",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
      }
    }

    // ROOT_PADDING_NO_RESPONSIVE_OVERRIDE: data-key=root with pt/pb but no md:pt/md:pb
    if (node?.attrs) {
      const dataKey = String(getAttrValue(node.attrs, "data-key") || "").trim().toLowerCase();
      if (dataKey === "root") {
        const tokens = getClassTokens(node.attrs);
        const basePt = tokens.some((t) => /^(?:pt-\[[^\]]+\]|pt-\d+)$/.test(normalizeToken(t)));
        const basePb = tokens.some((t) => /^(?:pb-\[[^\]]+\]|pb-\d+)$/.test(normalizeToken(t)));
        const hasResponsivePt = tokens.some((t) => /^(?:md|lg|xl|sm|max-):pt-/.test(String(t)));
        const hasResponsivePb = tokens.some((t) => /^(?:md|lg|xl|sm|max-):pb-/.test(String(t)));
        if ((basePt || basePb) && !(hasResponsivePt && hasResponsivePb)) {
          issues.push(
            makeIssue(
              "warn",
              RULES.ROOT_PADDING_NO_RESPONSIVE_OVERRIDE,
              "Root has pt/pb but no responsive override; use pt-[2.5rem] pb-[2.5rem] md:pt-[original] md:pb-[original]",
              nodeSignature(node),
              snippet(source, node),
              nodeIndex
            )
          );
        }
      }
    }

    // OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER: overflow-hidden, does not directly wrap img/video, no background video
    if (node?.attrs) {
      const tokens = getClassTokens(node.attrs).map(normalizeToken);
      if (tokens.includes("overflow-hidden")) {
        const childIdxs = getDirectChildren(childrenMap, nodeIndex);
        const hasAbsoluteBgLayer = childIdxs.some((idx) => isAbsoluteBackgroundFillLayer(nodes[idx]));
        if (hasAbsoluteBgLayer) return;
        const directChildIsMedia = childIdxs.some((idx) => {
          const t = (nodes[idx]?.tag || "").toLowerCase();
          return t === "img" || t === "video";
        });
        if (!directChildIsMedia) {
          let hasVideoDescendant = false;
          const queue = [...childIdxs];
          while (queue.length) {
            const idx = queue.shift();
            const n = nodes[idx];
            if (n && (n.tag || "").toLowerCase() === "video") {
              hasVideoDescendant = true;
              break;
            }
            queue.push(...getDirectChildren(childrenMap, idx));
          }
          if (!hasVideoDescendant) {
            issues.push(
              makeIssue(
                "warn",
                RULES.OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER,
                "overflow-hidden on wrapper that does not wrap img/video; remove unless clip-path required",
                nodeSignature(node),
                snippet(source, node),
                nodeIndex
              )
            );
          }
        }
      }
    }

    // CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP:
    // e.g. md:justify-center + md:justify-start on same element.
    if (node?.attrs) {
      const rawTokens = getClassTokens(node.attrs);
      const byKey = new Map();
      rawTokens.forEach((tok, tokenIndex) => {
        const key = responsiveConflictKey(tok);
        if (!key) return;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ tok, tokenIndex });
      });
      byKey.forEach((entries, key) => {
        const unique = new Set(entries.map((e) => String(e.tok)));
        if (unique.size <= 1) return;
        const sample = entries.map((e) => e.tok).join(" ");
        issues.push(
          makeIssue(
            "warn",
            RULES.CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP,
            `Conflicting responsive utilities for ${key}; keep the final intended token only`,
            nodeSignature(node),
            sample,
            nodeIndex,
            { conflictKey: key, conflictTokens: entries.map((e) => e.tok) }
          )
        );
      });
    }
  });

  const seenIds = new Set();
  nodes.forEach((node) => {
    const id = getAttrValue(node?.attrs, "id");
    if (id == null || String(id).trim() === "") return;
    if (seenIds.has(id)) {
      issues.push(
        makeIssue(
          "error",
          "duplicate-id",
          `Duplicate id="${id}"`,
          nodeSignature(node),
          snippet(source, node)
        )
      );
    } else {
      seenIds.add(id);
    }
  });

  const nodesByDataNodeId = new Map();
  nodes.forEach((node, nodeIndex) => {
    const dnid = String(getAttrValue(node?.attrs, "data-node-id") || "").trim();
    if (!dnid) return;
    if (!nodesByDataNodeId.has(dnid)) nodesByDataNodeId.set(dnid, []);
    nodesByDataNodeId.get(dnid).push(nodeIndex);
  });
  nodesByDataNodeId.forEach((idxs, dnid) => {
    if (idxs.length <= 1) return;
    const occurrences = idxs.map((idx) => ({
      selector: nodeSignature(nodes[idx]),
      snippet: snippet(source, nodes[idx], 200),
      nodeIndex: idx,
    }));
    const minimalReport = occurrences
      .map((occ, i) => `${i + 1}. data-node-id="${dnid}" | ${(occ.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200)}`)
      .join("\n");
    issues.push(
      makeIssue(
        "error",
        RULES.DUPLICATE_DATA_NODE_ID,
        `Duplicate data-node-id="${dnid}" found ${idxs.length} times. Auto-fix only when duplicate block is byte-identical (ignoring whitespace) and adjacent; otherwise use occurrences below to debug.`,
        occurrences[0]?.selector || null,
        occurrences[0]?.snippet || null,
        idxs[1] ?? idxs[0] ?? null,
        {
          fatal: true,
          duplicatedId: dnid,
          duplicateCount: idxs.length,
          occurrences,
          minimalReport,
        }
      )
    );
  });

  const nodesByDataKey = new Map();
  nodes.forEach((node, idx) => {
    const dk = String(getAttrValue(node?.attrs, "data-key") || "").trim();
    if (!dk) return;
    if (!nodesByDataKey.has(dk)) nodesByDataKey.set(dk, []);
    nodesByDataKey.get(dk).push(idx);
  });

  const rootKeyByTop = new Map();
  nodes.forEach((node, idx) => {
    const dk = String(getAttrValue(node?.attrs, "data-key") || "").trim().toLowerCase();
    if (dk !== "root") return;
    const top = topLevelAncestorIndex(nodes, idx);
    if (!rootKeyByTop.has(top)) rootKeyByTop.set(top, []);
    rootKeyByTop.get(top).push(idx);
  });
  rootKeyByTop.forEach((idxs) => {
    if (idxs.length <= 1) return;
    const occurrences = idxs.map((idx) => ({
      selector: nodeSignature(nodes[idx]),
      snippet: snippet(source, nodes[idx], 200),
      nodeIndex: idx,
    }));
    const minimalReport = occurrences
      .map((occ, i) => `${i + 1}. data-key="root" | ${(occ.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200)}`)
      .join("\n");
    issues.push(
      makeIssue(
        "error",
        RULES.DUPLICATE_DATA_KEY_ROOT,
        `Duplicate data-key="root" in same section/document (${idxs.length} occurrences). Auto-fix only when duplicate block is byte-identical (ignoring whitespace) and adjacent; otherwise use occurrences below to debug.`,
        occurrences[0]?.selector || null,
        occurrences[0]?.snippet || null,
        idxs[1] ?? idxs[0] ?? null,
        {
          fatal: true,
          duplicateCount: idxs.length,
          occurrences,
          minimalReport,
        }
      )
    );
  });

  nodesByDataKey.forEach((idxs, key) => {
    if (key.toLowerCase() === "root") return;
    if (idxs.length <= 1) return;
    issues.push(
      makeIssue(
        "warn",
        RULES.DUPLICATE_DATA_KEY,
        `Duplicate data-key="${key}" found ${idxs.length} times`,
        nodeSignature(nodes[idxs[0]]),
        snippet(source, nodes[idxs[0]]),
        idxs[1] ?? idxs[0] ?? null
      )
    );
  });

  const topLevelRoots = [];
  nodes.forEach((node, idx) => {
    if (node.parentIndex != null) return;
    if (!hasRootSignature(node)) return;
    topLevelRoots.push(idx);
  });
  if (topLevelRoots.length > 1) {
    const occurrences = topLevelRoots.map((idx) => ({
      selector: nodeSignature(nodes[idx]),
      snippet: snippet(source, nodes[idx], 200),
      nodeIndex: idx,
    }));
    const minimalReport = occurrences
      .map((occ, i) => `${i + 1}. ${occ.selector} | ${(occ.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200)}`)
      .join("\n");
    issues.push(
      makeIssue(
        "error",
        RULES.MULTIPLE_TOP_LEVEL_ROOTS,
        `Multiple top-level root containers detected (${topLevelRoots.length})`,
        occurrences[0]?.selector || null,
        occurrences[0]?.snippet || null,
        topLevelRoots[1] ?? topLevelRoots[0] ?? null,
        {
          fatal: true,
          duplicateCount: topLevelRoots.length,
          occurrences,
          minimalReport,
        }
      )
    );
  }

  // Catch exact duplicate sibling blocks even if node ids differ or are missing.
  const directChildrenByParent = new Map();
  nodes.forEach((node, idx) => {
    const p = node.parentIndex == null ? "__root__" : String(node.parentIndex);
    if (!directChildrenByParent.has(p)) directChildrenByParent.set(p, []);
    directChildrenByParent.get(p).push(idx);
  });

  directChildrenByParent.forEach((idxs) => {
    const firstBySignature = new Map();
    idxs.forEach((idx) => {
      const n = nodes[idx];
      if (!n) return;
      const start = n.start ?? n.openStart;
      const end = n.end ?? n.openEnd;
      if (start == null || end == null || end <= start) return;
      const outer = source.slice(start, end).trim();
      if (!outer) return;
      const sig = `${n.tag}|${outer}`;
      if (!firstBySignature.has(sig)) {
        firstBySignature.set(sig, idx);
        return;
      }
      issues.push(
        makeIssue(
          "error",
          RULES.DUPLICATE_SIBLING_BLOCK,
          "Exact duplicate sibling block detected",
          nodeSignature(n),
          snippet(source, n),
          idx
        )
      );
    });
  });

  const summary = {
    error: issues.filter((i) => i.severity === "error").length,
    warn: issues.filter((i) => i.severity === "warn").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  const byRule = {};
  issues.forEach((i) => {
    byRule[i.rule] = (byRule[i.rule] || 0) + 1;
  });

  return { issues, summary, byRule };
}

module.exports = { audit, RULES };
