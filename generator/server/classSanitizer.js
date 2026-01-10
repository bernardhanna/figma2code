// generator/server/classSanitizer.js

// Utility: strip classes we don’t allow (must only run on strings)
export function classStrip(s) {
  const str = typeof s === "string" ? s : "";
  return str.replace(/\bmin-w-\[\s*240px\s*\]\b/g, "").replace(/\baspect-\[[^\]]+\]\b/g, "");
}
