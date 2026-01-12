// generator/auto/autoLayoutify/semantics.js
// ------------------------------------------------------------
// Semantics helpers: decide tags/labels/links in a deterministic way.
// ------------------------------------------------------------

export function aiTagFor(node, semantics) {
  const found = semantics?.[node.id];
  if (!found || !found.tag) return null;

  const t = String(found.tag).toLowerCase();
  const ok = new Set([
    "a",
    "button",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "span",
    "nav",
    "header",
    "footer",
    "section",
    "ul",
    "ol",
    "li",
    "img",
    "div",
  ]);

  return ok.has(t) ? t : null;
}

export function aiHrefFor(node, semantics) {
  const found = semantics?.[node.id];
  if (!found) return null;

  const href = found.href || found.url;
  if (href && typeof href === "string" && href.trim()) return href.trim();
  return null;
}

export function aiLabelFor(node, semantics) {
  const found = semantics?.[node.id];
  if (!found) return null;

  const label = found.label || found.text || found.title;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

export function nameHints(node) {
  const n = (node.name || "").toLowerCase();
  return {
    isButton: /\b(btn|button|cta)\b/.test(n),
    isLink: /\b(link|href|a:)\b/.test(n),
    h1: /^h1[:\s]/.test(n),
    h2: /^h2[:\s]/.test(n),
    h3: /^h3[:\s]/.test(n),
    h4: /^h4[:\s]/.test(n),
    h5: /^h5[:\s]/.test(n),
    h6: /^h6[:\s]/.test(n),
    p: /^p[:\s]/.test(n) || /\bparagraph\b/.test(n),
    span: /^span[:\s]/.test(n) || /\blabel\b/.test(n),
  };
}

export function chooseTextTag(node) {
  const n = nameHints(node);
  if (n.h1) return "h1";
  if (n.h2) return "h2";
  if (n.h3) return "h3";
  if (n.h4) return "h4";
  if (n.h5) return "h5";
  if (n.h6) return "h6";
  if (n.p) return "p";
  if (n.span) return "span";

  const fs = node?.text?.fontSize || 16;
  if (fs >= 40) return "h1";
  if (fs >= 32) return "h2";
  if (fs >= 24) return "h3";
  if (fs >= 20) return "h4";
  if (node?.text?.uppercase && fs <= 16) return "span";
  return "p";
}

export function isClickable(node) {
  return !!node?.actions?.openUrl || !!node?.actions?.isClickable;
}

/**
 * Decide if a node should be rendered as <a> or <button>.
 *
 * Deterministic rule:
 * - If openUrl exists => ALWAYS <a>
 * - Else name hints can imply link/button
 * - Else clickability of INSTANCE implies button
 */
// generator/auto/autoLayoutify/semantics.js

function hasOwnClickAction(node) {
  if (!node) return false;
  if (node.actions?.openUrl) return true;
  if (node.actions?.isClickable === true) return true;
  return false;
}

function isProbablyLeafInteractive(node) {
  // Allow INTERACTIVE leafs: INSTANCE (CTA components), VECTOR icons, TEXT links, etc.
  // But do NOT auto-promote container frames/groups.
  const t = String(node?.type || "").toUpperCase();
  return t === "INSTANCE" || t === "TEXT" || t === "VECTOR" || t === "BOOLEAN_OPERATION";
}

function hasRenderableChildren(node) {
  return Array.isArray(node?.children) && node.children.length > 0;
}

/**
 * Decide whether to force rendering as <a> or <button>.
 *
 * Hard rule:
 * - Only force interactive if the node itself has explicit actions.
 * - Never infer interactivity for container nodes with children.
 * - If node is explicitly clickable:
 *    - openUrl => <a>
 *    - else => <button>
 */
export function shouldRenderAsLinkOrButton(node) {
  if (!node) return null;

  // If this node has children, it is a container. Do not auto-promote.
  // The only exception is if the container itself has explicit actions.
  const container = hasRenderableChildren(node);

  if (!hasOwnClickAction(node)) {
    // No explicit action: only allow leaf-style nodes to be treated as interactive
    // if your semantics map explicitly says so (handled by aiTagFor elsewhere).
    return null;
  }

  // Explicit actions exist
  if (node.actions?.openUrl) return "a";

  // Only allow <button> for:
  // - clickable leaf nodes
  // - clickable containers IF they are "rasterized CTA instances" (rare) — but we keep it strict.
  if (!container || isProbablyLeafInteractive(node)) return "button";

  // Container with action: still avoid turning an entire layout frame into a button.
  // Render it as a div and let inner CTAs be the interactive elements.
  return null;
}
