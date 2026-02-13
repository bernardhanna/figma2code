"use strict";

const { getAttrValue, getClassTokens } = require("../../stage.codeit/contracts/utils/html");

/** Normalized height tokens to guard: h-[...], min-h-[...], max-h-[...] (responsive prefix stripped by normalizeToken) */
const HEIGHT_TOKEN_GUARD = /^(h|min-h|max-h)-\[.*\]$/;

const MEDIA_TAGS = new Set([
  "img", "video", "picture", "source", "svg", "canvas",
  "iframe", "embed", "object", "figure",
]);

const DATA_KEY_PROTECTED = /hero|image|media|banner|bg/i;

const normalizeToken = (token) => String(token || "").split(":").pop();

/**
 * True if the node should not have height tokens removed (protected media/hero/container).
 * @param {object} node - Parsed node with .attrs, .tag
 * @param {{ nodes: array, childrenMap: Map<number, number[]>, nodeIndex: number }} context
 * @returns {boolean}
 */
function isProtectedMediaNode(node, context = {}) {
  if (!node?.attrs) return false;

  const tokens = getClassTokens(node.attrs);
  const normalized = tokens.map(normalizeToken);

  if (getAttrValue(node.attrs, "data-h-intent") === "fixed") return true;

  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (DATA_KEY_PROTECTED.test(dataKey)) return true;

  const overflowHidden = normalized.some((t) => t === "overflow-hidden");
  const rounded = normalized.some((t) => /^rounded/.test(t));
  if (overflowHidden && rounded) return true;

  if (MEDIA_TAGS.has(node.tag)) return true;

  const role = String(getAttrValue(node.attrs, "role") || "").toLowerCase();
  if (role === "img" || role === "presentation" || role === "figure") return true;

  const hasRelative = normalized.some((t) => t === "relative");
  const childrenMap = context.childrenMap;
  const nodeIndex = context.nodeIndex;
  if (hasRelative && childrenMap && nodeIndex != null) {
    const hasAbsoluteInset0Child = hasAbsoluteInset0Descendant(
      context.nodes,
      childrenMap,
      nodeIndex
    );
    if (hasAbsoluteInset0Child) return true;
  }

  return false;
}

function hasAbsoluteInset0Descendant(nodes, childrenMap, nodeIndex) {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) {
      queue.push(...(childrenMap.get(idx) || []));
      continue;
    }
    const tokens = getClassTokens(node.attrs);
    const norm = tokens.map(normalizeToken);
    const hasAbsolute = norm.some((t) => t === "absolute" || t === "fixed");
    const hasInset0 = norm.some((t) => /^inset-0$/.test(t) || /^inset-\[0\]$/.test(t));
    if (hasAbsolute && hasInset0) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
}

/**
 * True only when clipping can be proven: overflow hidden/clip + text-like content + scrollHeight > clientHeight.
 * Without DOM measurements this returns false.
 * @param {object} node
 * @param {{ scrollHeight?: number, clientHeight?: number, overflowHidden?: boolean, hasTextLikeContent?: boolean }} measurements
 * @returns {boolean}
 */
function canProveClipping(node, measurements = {}) {
  if (!node) return false;
  const m = measurements;
  const overflowOk = m.overflowHidden === true;
  const hasTextLike = m.hasTextLikeContent === true;
  const clipped = typeof m.scrollHeight === "number" && typeof m.clientHeight === "number" && m.scrollHeight > m.clientHeight;
  return Boolean(overflowOk && hasTextLike && clipped);
}

/**
 * Regex to test if a class token is a guarded height token.
 * @param {string} token - May include responsive prefix, e.g. "lg:h-[27.5rem]"
 * @returns {boolean}
 */
function isHeightTokenGuarded(token) {
  const core = normalizeToken(token);
  return HEIGHT_TOKEN_GUARD.test(core);
}

/**
 * Filter plan entries: reject any patch that removes a guarded height token from a protected node,
 * or that removes height without proven clipping.
 * @param {Array<{ patch: object, ledgerEntries: array }>} planEntries
 * @param {{ nodeMap: Map, isProtected: (node, ctx) => boolean, canProveClipping: (node, m) => boolean, getMeasurements: (nodeId) => object }} context
 * @returns {{ accepted: array, rejectedWithReasons: Array<{ entry: object, reason: string, nodeId?: string }> }}
 */
function guardedHeightPatchFilter(planEntries, context = {}) {
  const accepted = [];
  const rejectedWithReasons = [];
  const nodeMap = context.nodeMap || new Map();
  const isProtected = context.isProtected || (() => false);
  const canProve = context.canProveClipping || (() => false);
  const getMeasurements = context.getMeasurements || (() => ({}));

  for (const entry of planEntries) {
    const patch = entry.patch || entry;
    const removes = (patch.ops && patch.ops.classRemove) || [];
    const heightRemovals = removes.filter(isHeightTokenGuarded);
    if (!heightRemovals.length) {
      accepted.push(entry);
      continue;
    }

    const nodeId = patch.nodeId;
    const nodeEntry = nodeMap.get(nodeId);
    const node = nodeEntry && nodeEntry.node;
    const ctx = nodeEntry && nodeEntry.context ? nodeEntry.context : { nodes: [], childrenMap: new Map(), nodeIndex: null };

    if (node && isProtected(node, ctx)) {
      rejectedWithReasons.push({
        entry,
        reason: "blocked: protected media/hero height",
        nodeId: nodeId || undefined,
      });
      continue;
    }

    const measurements = getMeasurements(nodeId);
    if (!canProve(node, measurements)) {
      rejectedWithReasons.push({
        entry,
        reason: "clipping not proven",
        nodeId: nodeId || undefined,
      });
      continue;
    }

    accepted.push(entry);
  }

  return { accepted, rejectedWithReasons };
}

module.exports = {
  HEIGHT_TOKEN_GUARD,
  isProtectedMediaNode,
  canProveClipping,
  isHeightTokenGuarded,
  guardedHeightPatchFilter,
  hasAbsoluteInset0Descendant,
};
