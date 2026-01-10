// generator/auto/autoLayoutify/escape.js
/* ================== ESCAPING ================== */

export function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escAttr(s = "") {
  return String(s).replace(/"/g, "&quot;");
}

export function escCssUrl(url = "") {
  return encodeURI(String(url)).replace(/'/g, "%27");
}
