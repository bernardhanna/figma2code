// generator/contracts/textLinkSimplifier.contract.js
import { cls } from "../auto/autoLayoutify/precision.js";
import { escAttr } from "../auto/autoLayoutify/escape.js";

function effectiveChildren(node) {
  if (Array.isArray(node?.children) && node.children.length) return node.children;
  const stateKids = node?.__states?.default?.children;
  if (Array.isArray(stateKids) && stateKids.length) return stateKids;
  return [];
}

function dfs(node, visit, seen = new Set()) {
  if (!node || seen.has(node)) return;
  seen.add(node);
  visit(node);
  for (const c of effectiveChildren(node)) dfs(c, visit, seen);
}

function firstTextNode(node) {
  let found = null;
  dfs(node, (n) => {
    if (found) return;
    if (n?.text && typeof n.text.raw === "string" && n.text.raw.trim()) found = n;
  });
  return found;
}

function isImgOrSvgLike(n) {
  if (!n || typeof n !== "object") return false;
  const t = String(n.type || "").toUpperCase();
  return !!n?.img?.src || t === "SVG";
}

function firstIconNode(node) {
  let found = null;
  dfs(node, (n) => {
    if (found) return;
    if (n === node) return;
    if (isImgOrSvgLike(n)) found = n;
  });
  return found;
}

export function extractTextLinkParts(node, fallbackLabel = "") {
  const labelNode = firstTextNode(node);
  const labelText = String(labelNode?.text?.raw || fallbackLabel || "").trim();
  const iconNode = firstIconNode(node);
  return {
    labelText,
    labelNode: labelNode || null,
    iconNode: iconNode || null,
  };
}

export function renderTextLinkSimplifiedBody({
  node,
  semantics,
  ctx,
  renderNode,
  typographyClassesFromTextNode,
  fallbackLabel,
  fallbackTypoClass = "",
}) {
  const parts = extractTextLinkParts(node, fallbackLabel);
  if (!parts.labelText) return null;

  const textTypo = typographyClassesFromTextNode(parts.labelNode, ctx);
  const labelHtml = `<span class="${escAttr(
    cls("text-left", textTypo || fallbackTypoClass || "")
  )}">${escAttr(parts.labelText)}</span>`;

  const iconHtml = resolveIconMarkup({ node, parts, semantics, ctx, renderNode });
  if (!String(iconHtml).trim()) return labelHtml;

  // Canonical shape: exactly two direct children (label span + icon img/svg).
  return `${labelHtml}${iconHtml}`;
}

function resolveIconMarkup({ node, parts, semantics, ctx, renderNode }) {
  let iconHtml = "";
  if (parts.iconNode) {
    iconHtml = normalizeIconMarkup(
      renderNode(parts.iconNode, "HORIZONTAL", false, semantics, ctx) || ""
    );
  }
  if (String(iconHtml).trim()) return iconHtml;

  // Fallback: render original descendants and extract first icon element.
  const candidates = effectiveChildren(node)
    .map((c) => renderNode(c, "HORIZONTAL", false, semantics, ctx))
    .join("\n");
  const extracted = extractFirstIconElement(candidates);
  return normalizeIconMarkup(extracted || "");
}

function normalizeIconMarkup(iconHtml) {
  const raw = String(iconHtml || "");
  if (!raw.trim()) return "";
  // For simplified text links, do not force layout classes on icon element.
  // Keep intrinsic sizing from asset/SVG attributes.
  return raw.replace(/\sclass="[^"]*"/i, "");
}

function extractFirstIconElement(html) {
  const s = String(html || "");
  if (!s.trim()) return "";
  const svg = s.match(/<svg\b[\s\S]*?<\/svg>/i);
  if (svg) return svg[0];
  const img = s.match(/<img\b[^>]*\/?>/i);
  if (img) return img[0];
  return "";
}
