const id = "test/regression";

const apply = ({ html }) => {
  const source = String(html || "");
  return {
    html: source + "<!-- regressed -->",
    changes: [
      {
        contractId: id,
        nodeId: "node-1",
        selector: "[data-key=\"node-1\"]",
        op: "classRemove",
        value: "w-[10rem]",
        reason: "Resolved conflicting Tailwind class token(s)",
      },
    ],
    warnings: [],
    stats: { touched: 1 },
  };
};

module.exports = {
  id,
  apply,
};
