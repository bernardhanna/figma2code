// generator/auto/autoLayoutify/precision.js
/* ------------------ precision helpers ------------------ */

// Generic rounding (layout/shadows/etc.)
export const rnd = (n, dp = 6) => Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp);
export const rem = (px) => `${rnd((px || 0) / 16, 6)}rem`;

// Typography-specific rem: preserve exact values (1px => 0.0625rem), avoid rounding drift.
// Keeps up to 6dp and trims trailing zeros.
export function remTypo(px) {
  const v = typeof px === "number" && !Number.isNaN(px) ? px : 0;
  const r = v / 16;
  const s = r.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${s || "0"}rem`;
}

export const cls = (...parts) => [...new Set(parts.flat().filter(Boolean))].join(" ").trim();

export const num = (n) => typeof n === "number" && !Number.isNaN(n);
export const pos = (n) => num(n) && n > 0;
