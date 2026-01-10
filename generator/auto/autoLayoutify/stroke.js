// generator/auto/autoLayoutify/stroke.js

export function visibleStroke(node) {
  if (!node?.stroke?.weight || node.stroke.weight <= 0) return null;
  const c = node.stroke.color;
  if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return null;
  const a = typeof c.a === "number" ? c.a : 1;
  if (a <= 0.001) return null;
  return { weight: node.stroke.weight, color: { r: c.r, g: c.g, b: c.b, a } };
}
