export function evaluateImprovement({ beforeDiff, afterDiff, epsilon = 0.0005 }) {
  const before = Number.isFinite(Number(beforeDiff)) ? Number(beforeDiff) : 1;
  const after = Number.isFinite(Number(afterDiff)) ? Number(afterDiff) : 1;
  const eps = Math.max(0, Number.isFinite(Number(epsilon)) ? Number(epsilon) : 0.0005);
  const improvedBy = before - after;
  return {
    improvedBy,
    accept: improvedBy > eps,
    plateau: Math.abs(improvedBy) < eps,
  };
}
