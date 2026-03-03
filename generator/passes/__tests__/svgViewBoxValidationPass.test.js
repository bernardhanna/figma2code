import test from "node:test";
import assert from "node:assert/strict";

import { svgViewBoxValidationPass } from "../svgViewBoxValidationPass.js";

test("adds/normalizes viewBox, width, height and preserveAspectRatio", () => {
  const ast = {
    slug: "svg-pass-1",
    type: "flexi_block",
    tree: {
      id: "icon",
      name: "icon",
      type: "svg",
      w: 24,
      h: 18,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',
      children: [],
    },
  };

  const out = svgViewBoxValidationPass(ast);
  assert.match(out.tree.svg, /viewBox="0 0 24 18"/);
  assert.match(out.tree.svg, /width="24"/);
  assert.match(out.tree.svg, /height="18"/);
  assert.match(out.tree.svg, /preserveAspectRatio="xMidYMid meet"/);
});

test("repairs invalid root dimensions and strips noisy root style size tokens", () => {
  const ast = {
    slug: "svg-pass-2",
    type: "flexi_block",
    tree: {
      id: "icon",
      name: "icon",
      type: "svg",
      w: 0,
      h: null,
      bb: { x: 0, y: 0, w: 20, h: 10 },
      svg: '<svg style="width:100%;height:100%;color:red"><path d="M0 0L2 2"/></svg>',
      children: [],
    },
  };
  const out = svgViewBoxValidationPass(ast);
  assert.equal(out.tree.w, 20);
  assert.equal(out.tree.h, 10);
  assert.match(out.tree.svg, /viewBox="0 0 20 10"/);
  assert.match(out.tree.svg, /style="color:red"/);
  assert.doesNotMatch(out.tree.svg, /style="[^"]*width:/i);
  assert.doesNotMatch(out.tree.svg, /style="[^"]*height:/i);
});

