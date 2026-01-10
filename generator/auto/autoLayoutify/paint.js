// generator/auto/autoLayoutify/paint.js
import { rnd } from "./precision.js";

export function gradientToCss(g) {
  if (!g || g.kind !== "gradient") return "";
  if (g.type === "LINEAR") {
    const angle = `${rnd(g.angle, 6)}deg`;
    const stops = (g.stops || [])
      .map(
        (s) =>
          `rgba(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)},${s.a ?? 1}) ${Math.round(
            (s.pos ?? 0) * 100
          )}%`
      )
      .join(", ");
    return `linear-gradient(${angle}, ${stops})`;
  }
  if (g.type === "RADIAL") {
    const cx = Math.round((g.cx ?? 0.5) * 100);
    const cy = Math.round((g.cy ?? 0.5) * 100);
    const stops = (g.stops || [])
      .map(
        (s) =>
          `rgba(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)},${s.a ?? 1}) ${Math.round(
            (s.pos ?? 0) * 100
          )}%`
      )
      .join(", ");
    return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
  }
  return "";
}

export function blendToTW(mode) {
  const map = {
    MULTIPLY: "mix-blend-multiply",
    SCREEN: "mix-blend-screen",
    OVERLAY: "mix-blend-overlay",
    DARKEN: "mix-blend-darken",
    LIGHTEN: "mix-blend-lighten",
    COLOR_DODGE: "mix-blend-color-dodge",
    COLOR_BURN: "mix-blend-color-burn",
    HARD_LIGHT: "mix-blend-hard-light",
    SOFT_LIGHT: "mix-blend-soft-light",
    DIFFERENCE: "mix-blend-difference",
    EXCLUSION: "mix-blend-exclusion",
    HUE: "mix-blend-hue",
    SATURATION: "mix-blend-saturation",
    COLOR: "mix-blend-color",
    LUMINOSITY: "mix-blend-luminosity",
  };
  return map[mode] || "";
}
