// generator/auto/autoLayoutify/precision.js
/* ------------------ precision helpers ------------------ */

// Generic rounding (layout/shadows/etc.)
export const rnd = (n, dp = 6) => Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp);
export const rem = (px) => `${rnd((px || 0) / 16, 6)}rem`;
const trimNum = (n) =>
  String(Number(Number(n || 0).toFixed(6)))
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
const pxBracket = (px) => `${trimNum(px)}px`;

// Tailwind spacing quantization:
// - Snap to scale when close enough (avoids noisy near-duplicate arbitrary values).
// - Fall back to arbitrary bracket value when needed for fidelity.
const TW_SPACING_SCALE = [
  ["0", 0],
  ["0.5", 2],
  ["1", 4],
  ["1.5", 6],
  ["2", 8],
  ["2.5", 10],
  ["3", 12],
  ["3.5", 14],
  ["4", 16],
  ["5", 20],
  ["6", 24],
  ["7", 28],
  ["8", 32],
  ["9", 36],
  ["10", 40],
  ["11", 44],
  ["12", 48],
  ["14", 56],
  ["16", 64],
  ["20", 80],
  ["24", 96],
  ["28", 112],
  ["32", 128],
  ["36", 144],
  ["40", 160],
  ["44", 176],
  ["48", 192],
  ["52", 208],
  ["56", 224],
  ["60", 240],
  ["64", 256],
  ["72", 288],
  ["80", 320],
  ["96", 384],
];

function nearestSpacingScale(px) {
  const target = Number(px);
  if (!Number.isFinite(target) || target < 0) return null;
  let best = null;
  for (const [key, scalePx] of TW_SPACING_SCALE) {
    const delta = Math.abs(scalePx - target);
    if (!best || delta < best.delta) best = { key, px: scalePx, delta };
  }
  return best;
}

function parsePx(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  const remMatch = raw.match(/^([0-9.]+)rem$/i);
  if (remMatch) return Number(remMatch[1]) * 16;
  const pxMatch = raw.match(/^([0-9.]+)px$/i);
  if (pxMatch) return Number(pxMatch[1]);
  const asNum = Number(raw);
  return Number.isFinite(asNum) ? asNum : NaN;
}

export function spacingClass(prefix, px, options = {}) {
  const pfx = String(prefix || "").trim();
  if (!pfx) return "";
  const value = parsePx(px);
  if (!Number.isFinite(value) || value <= 0) return "";

  if (options.forcePxBracket === true) {
    return `${pfx}-[${pxBracket(value)}]`;
  }

  const nearest = nearestSpacingScale(value);
  const tolPx = Number(options.tolerancePx);
  const tolerancePx = Number.isFinite(tolPx)
    ? Math.max(0, tolPx)
    : Math.max(0.5, value * 0.06); // 6% or half-pixel

  if (nearest && nearest.delta <= tolerancePx) {
    return `${pfx}-${nearest.key}`;
  }
  return `${pfx}-[${rem(value)}]`;
}

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
