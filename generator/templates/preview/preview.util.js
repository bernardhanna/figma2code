// generator/templates/preview/preview.util.js

export function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function cssFontStack(family) {
  const fam = String(family || "").trim();
  if (!fam)
    return `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const quoted = /\s/.test(fam) ? "'" + fam.replace(/'/g, "\\'") + "'" : fam;
  return (
    quoted +
    `, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
  );
}
