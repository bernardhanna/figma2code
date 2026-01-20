// generator/auto/autoLayoutify/escape.js
/* ================== ESCAPING ================== */

export function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAX_INLINE_DATA = Number(process.env.MAX_INLINE_DATA || 200000);

export function escAttr(s = "") {
  const str = String(s);
  if (MAX_INLINE_DATA > 0 && str.length > MAX_INLINE_DATA) return "";
  return str.replace(/"/g, "&quot;");
}

export function escCssUrl(url = "") {
  const str = String(url);
  if (MAX_INLINE_DATA > 0 && str.length > MAX_INLINE_DATA) return "";
  return encodeURI(str).replace(/'/g, "%27");
}
