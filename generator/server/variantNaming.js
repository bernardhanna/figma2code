// generator/server/variantNaming.js

const VARIANTS = new Set(["mobile", "tablet", "desktop"]);

export function parseGroupVariant(input) {
  const raw = String(input || "").trim();
  if (!raw) return { isVariant: false, groupKey: "", variant: "" };

  const m = raw.match(/^(.+?)@([a-zA-Z]+)$/);
  if (!m) return { isVariant: false, groupKey: raw, variant: "" };

  const groupKey = String(m[1] || "").trim();
  const variant = String(m[2] || "").trim().toLowerCase();

  if (!groupKey || !VARIANTS.has(variant)) {
    return { isVariant: false, groupKey: raw, variant: "" };
  }

  return { isVariant: true, groupKey, variant };
}

export function isValidVariant(v) {
  return VARIANTS.has(String(v || "").toLowerCase());
}
