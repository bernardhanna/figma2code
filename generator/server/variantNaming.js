const VARIANTS = new Set(["mobile", "tablet", "desktop"]);

export function parseGroupVariant(input) {
  const raw = String(input || "").trim();
  if (!raw) return { isVariant: false, groupKey: "", variant: "" };

  const s = raw.replace(/\s+/g, " ").trim();

  // @mobile / @tablet / @desktop
  let m = s.match(/^(.*?)[\s]*@(mobile|tablet|desktop)\s*$/i);
  if (m) {
    return { isVariant: true, groupKey: m[1].trim(), variant: m[2].toLowerCase() };
  }

  // _mobile / -mobile
  m = s.match(/^(.*?)(?:[_-])(mobile|tablet|desktop)\s*$/i);
  if (m) {
    return { isVariant: true, groupKey: m[1].trim(), variant: m[2].toLowerCase() };
  }

  // trailing word "mobile" (e.g. "Home v3 Mobile")
  m = s.match(/^(.*?)\s+(mobile|tablet|desktop)\s*$/i);
  if (m) {
    return { isVariant: true, groupKey: m[1].trim(), variant: m[2].toLowerCase() };
  }

  return { isVariant: false, groupKey: s, variant: "" };
}

export function isValidVariant(v) {
  return VARIANTS.has(String(v || "").toLowerCase());
}