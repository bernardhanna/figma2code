const splitTokens = (value) =>
  String(value || "")
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);

const dedupeTokens = (tokens) => {
  const seen = new Set();
  const cleaned = [];
  const removed = [];

  (Array.isArray(tokens) ? tokens : []).forEach((token) => {
    if (!token) return;
    if (seen.has(token)) {
      removed.push(token);
      return;
    }
    seen.add(token);
    cleaned.push(token);
  });

  return { cleaned, removed };
};

const removeTokens = (tokens, predicate) => {
  const removed = [];
  const cleaned = [];

  (Array.isArray(tokens) ? tokens : []).forEach((token) => {
    if (!token) return;
    if (predicate(token)) {
      removed.push(token);
      return;
    }
    cleaned.push(token);
  });

  return { cleaned, removed };
};

module.exports = {
  splitTokens,
  dedupeTokens,
  removeTokens,
};
