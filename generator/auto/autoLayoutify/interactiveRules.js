// generator/auto/autoLayoutify/interactiveRules.js
// Enforces valid HTML: no nested <button>/<a>, CTA-only interactivity,
// and hardened attribute escaping to prevent broken markup.

export function isCtaNode(node) {
  const name = String(node?.name || "").toLowerCase();

  // Strong signals
  if (name.includes("elem: cta")) return true;

  // Reasonable fallbacks
  if (name.includes("cta")) return true;
  if (name.includes("button")) return true;
  if (name.includes("btn")) return true;

  return false;
}

export function pickInteractiveTag(node, insideInteractive) {
  if (insideInteractive) return "div";

  if (!isCtaNode(node)) return "div";

  const hasUrl = !!node?.actions?.openUrl;
  return hasUrl ? "a" : "button";
}

/**
 * Prevent attribute/class corruption that can break the DOM.
 * Use this for ANY attribute value (class, aria-label, etc).
 */
export function safeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
