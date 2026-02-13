const test = require("node:test");
const assert = require("node:assert/strict");

const { validatePatch } = require("../utilities/patches");

test("rejects disallowed attr ops", () => {
  const result = validatePatch({
    nodeId: "node-1",
    selector: "[data-key=\"node-1\"]",
    ops: {
      classAdd: ["text-sm"],
      classRemove: [],
      classReplace: {},
      attrAdd: { style: "color:red" },
      attrRemove: [],
    },
  });
  assert.equal(result.valid, false);
});

test("accepts bounded class and aria ops", () => {
  const result = validatePatch({
    nodeId: "node-1",
    selector: "[data-key=\"node-1\"]",
    ops: {
      classAdd: ["text-sm"],
      classRemove: ["text-lg"],
      classReplace: { "gap-4": "gap-3" },
      attrAdd: { "aria-label": "Read more" },
      attrRemove: ["aria-hidden"],
    },
  });
  assert.equal(result.valid, true);
  assert.ok(result.patch);
});
