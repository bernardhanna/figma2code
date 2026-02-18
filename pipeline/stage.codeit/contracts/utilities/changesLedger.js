const normalizeEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const contractId = String(entry.contractId || "").trim();
  if (!contractId) return null;

  const nodeId = entry.nodeId ? String(entry.nodeId) : null;
  const selector = entry.selector ? String(entry.selector) : "";
  const op = entry.op ? String(entry.op) : "";
  const value = entry.value !== undefined && entry.value !== null ? String(entry.value) : "";
  const reason = entry.reason ? String(entry.reason) : "";

  return {
    contractId,
    nodeId,
    selector,
    op,
    value,
    reason,
    at: entry.at || new Date().toISOString(),
  };
};

const createLedger = () => {
  const entries = [];

  const add = (entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized) entries.push(normalized);
    return normalized;
  };

  const addMany = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry) => add(entry));
  };

  return {
    entries,
    add,
    addMany,
  };
};

const summarizeLedger = (entries) => {
  const groups = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const reason = String(entry?.reason || "Other fixes").trim() || "Other fixes";
    if (!groups.has(reason)) {
      groups.set(reason, { reason, count: 0, nodes: new Set() });
    }
    const group = groups.get(reason);
    group.count += 1;
    if (entry?.nodeId) {
      group.nodes.add(entry.nodeId);
    }
  });

  return Array.from(groups.values()).map((group) => ({
    reason: group.reason,
    count: group.count,
    nodes: Array.from(group.nodes),
  }));
};

module.exports = {
  normalizeEntry,
  createLedger,
  summarizeLedger,
};
