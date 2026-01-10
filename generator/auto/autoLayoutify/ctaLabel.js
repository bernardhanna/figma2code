// generator/auto/autoLayoutify/ctaLabel.js

/**
 * CTA labels MUST come from text content in the AST.
 * Priority:
 *  1) explicit semantics label if provided
 *  2) recovered instance CTA payload (node.cta.label)
 *  3) recovered instance text runs (node.__instanceText[].raw)
 *  4) first descendant text node (DFS)
 *
 * Never default to node.name like "CTA Button".
 */

function firstDescendantText(node) {
  if (!node) return "";

  // direct text payload on this node
  const rawHere = node?.text?.raw;
  if (typeof rawHere === "string" && rawHere.trim()) return rawHere.trim();

  // walk children depth-first
  const kids = node.children || [];
  for (const k of kids) {
    const found = firstDescendantText(k);
    if (found) return found;
  }
  return "";
}

function recoveredInstanceLabel(node) {
  if (!node) return "";

  // 1) explicit recovered CTA label
  const ctaLabel = node?.cta?.label;
  if (typeof ctaLabel === "string" && ctaLabel.trim()) return ctaLabel.trim();

  // 2) recovered instance text runs (can be array of text payloads)
  const runs = node?.__instanceText;
  if (Array.isArray(runs) && runs.length) {
    const joined = runs
      .map((r) => (typeof r?.raw === "string" ? r.raw.trim() : ""))
      .filter(Boolean)
      .join(" ")
      .trim();

    if (joined) return joined;
  }

  return "";
}

export function resolveCtaLabel(node, semantics) {
  // 1) semantics label (strongest)
  const sem = semantics?.[node?.id];
  if (typeof sem?.label === "string" && sem.label.trim()) return sem.label.trim();

  // 2) recovered instance label/text runs
  const recovered = recoveredInstanceLabel(node);
  if (recovered) return recovered;

  // 3) actual text nodes in descendants
  return firstDescendantText(node);
}

/**
 * Render CTA inner HTML:
 * - If children exist: render them all using renderChild (text nodes + svg nodes will appear)
 * - If no children: synthesize <span>label</span> using resolved label
 *
 * IMPORTANT: This function must NEVER return "CTA Button" unless that text exists in Figma.
 */
export function resolveCtaInnerHtml(node, semantics, renderChild) {
  const kids = node.children || [];
  if (kids.length) {
    return kids.map((c) => renderChild(c)).join("");
  }

  const label = resolveCtaLabel(node, semantics);
  if (!label) return "";

  // Keep this minimal; typography is handled elsewhere when true text nodes exist.
  // This fallback is used when the AST has no children at all (e.g., rasterized INSTANCE).
  return `<span class="self-stretch my-auto">${escapeHtml(label)}</span>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
