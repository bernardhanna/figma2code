// generator/auto/autoLayoutify/stroke.js

function normalizeAlign(raw) {
  const v = String(raw || "").toUpperCase();
  if (v === "INSIDE" || v === "CENTER" || v === "OUTSIDE") return v;
  return "INSIDE";
}

function fromStrokeObject(stroke) {
  if (!stroke || typeof stroke !== "object") return null;
  if (!stroke.weight || stroke.weight <= 0) return null;
  const c = stroke.color;
  if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return null;
  const a = typeof c.a === "number" ? c.a : 1;
  if (a <= 0.001) return null;
  return {
    weight: stroke.weight,
    align: normalizeAlign(stroke.align),
    color: { r: c.r, g: c.g, b: c.b, a },
  };
}

export function visibleStroke(node) {
  const direct = fromStrokeObject(node?.stroke);
  if (direct) return direct;

  const strokes = Array.isArray(node?.strokes) ? node.strokes : [];
  for (const s of strokes) {
    const resolved = fromStrokeObject(s);
    if (resolved) return resolved;
  }
  return null;
}
