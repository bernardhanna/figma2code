// generator/auto/__tests__/dropdownWidget.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { variantLinkPass } from "../variantLinkPass.js";
import { autoLayoutify } from "../autoLayoutify/index.js";

test("dropdown widget renders a real <select> with options", () => {
  const ast = {
    slug: "dropdown-widget",
    type: "flexi_block",
    tree: {
      id: "dropdown-root",
      name: "Practice Area Dropdown",
      type: "FRAME",
      w: 360,
      h: 52,
      auto: {
        layout: "HORIZONTAL",
        itemSpacing: 12,
        padT: 12,
        padR: 16,
        padB: 12,
        padL: 16,
        primaryAlign: "MIN",
        counterAlign: "CENTER",
        primarySizing: "FIXED",
        counterSizing: "FIXED",
      },
      stroke: { weight: 1, color: { r: 0, g: 0, b: 0, a: 0.2 } },
      fills: [{ kind: "solid", r: 1, g: 1, b: 1, a: 1 }],
      children: [
        {
          id: "dropdown-placeholder",
          name: "Placeholder",
          type: "TEXT",
          text: {
            raw: "Select a practice area",
            fontSize: 16,
            fontWeight: 400,
            lineHeightPx: 24,
            align: "left",
            color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          },
        },
        {
          id: "dropdown-arrow",
          name: "Chevron Down",
          type: "VECTOR",
          w: 12,
          h: 12,
          vector: { d: "M2 4L6 8L10 4" },
        },
      ],
    },
  };

  variantLinkPass(ast, { viewport: "desktop" });

  const semantics = ast.semantics || {};
  const html = autoLayoutify(ast, { semantics, wrap: false, fontMap: {} });

  assert.ok(/<select\b/i.test(html), "expected select to render");
  assert.ok(/<option\b/i.test(html), "expected options to render");
  assert.ok(
    /<option value="">Select a practice area<\/option>/i.test(html),
    "expected placeholder option to render"
  );
});
