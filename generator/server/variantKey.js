// generator/server/variantKey.js

export function parseVariantKey(nameSource) {
  const s = String(nameSource || "").trim();

  // Accept: "hero_v3@mobile", "Hero v3 @ desktop", etc.
  const m = s.match(/^(.*)@(\s*mobile|tablet|desktop)\s*$/i);

  if (!m) {
    return { isVariant: false, groupKey: toGroupSlug(s), variant: "" };
  }

  const base = String(m[1] || "").trim();
  const variant = String(m[2] || "").trim().toLowerCase();

  return { isVariant: true, groupKey: toGroupSlug(base), variant };
}

export function toGroupSlug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/i, "") // drop any "@..."
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}
