// generator/auto/__tests__/sliderWidget.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { variantLinkPass } from "../variantLinkPass.js";
import { autoLayoutify } from "../autoLayoutify/index.js";

test("slider widget marks slick container and controls", () => {
  const ast = {
    slug: "slider-widget",
    type: "flexi_block",
    tree: {
      id: "slider-root",
      name: "Testimonials Slider slick slides-3 center fade infinite",
      type: "FRAME",
      w: 800,
      h: 320,
      children: [
        {
          id: "slides-group",
          name: "Slides",
          type: "FRAME",
          children: [
            {
              id: "slide-1",
              name: "Slide 1",
              type: "FRAME",
              w: 300,
              h: 200,
              children: [],
            },
            {
              id: "slide-2",
              name: "Slide 2",
              type: "FRAME",
              w: 300,
              h: 200,
              children: [],
            },
          ],
        },
        {
          id: "arrow-left",
          name: "Arrow Left",
          type: "VECTOR",
          vector: { d: "M10 16L4 10l6-6" },
        },
        {
          id: "arrow-right",
          name: "Arrow Right",
          type: "VECTOR",
          vector: { d: "M6 16l6-6-6-6" },
        },
        {
          id: "dots",
          name: "Dots",
          type: "FRAME",
          children: [],
        },
      ],
    },
  };

  variantLinkPass(ast, { viewport: "desktop" });

  const semantics = ast.semantics || {};
  const html = autoLayoutify(ast, { semantics, wrap: false, fontMap: {} });

  assert.ok(/data-widget="slick"/i.test(html), "expected slick data-widget");
  assert.ok(/data-slick-id="slider-root"/i.test(html), "expected slick id");
  assert.ok(/data-slick-prev="slider-root"/i.test(html), "expected prev arrow binding");
  assert.ok(/data-slick-next="slider-root"/i.test(html), "expected next arrow binding");
  assert.ok(/data-slick-dots="slider-root"/i.test(html), "expected dots binding");
  assert.ok(/data-slick-slides="3"/i.test(html), "expected slides attribute");
  assert.ok(/data-slick-center="1"/i.test(html), "expected center attribute");
  assert.ok(/data-slick-fade="1"/i.test(html), "expected fade attribute");
  assert.ok(/data-slick-infinite="1"/i.test(html), "expected infinite attribute");
});

test("slider widget infers slides and gap from layout", () => {
  const ast = {
    slug: "slider-gap-widget",
    type: "flexi_block",
    tree: {
      id: "slider-root",
      name: "Logo Slider slick",
      type: "FRAME",
      w: 960,
      h: 240,
      children: [
        {
          id: "slides-group",
          name: "Slides",
          type: "FRAME",
          w: 960,
          h: 240,
          auto: {
            layout: "HORIZONTAL",
            itemSpacing: 20,
            padT: 0,
            padR: 0,
            padB: 0,
            padL: 0,
            primaryAlign: "MIN",
            counterAlign: "CENTER",
            primarySizing: "FIXED",
            counterSizing: "FIXED",
          },
          children: [
            { id: "slide-1", name: "Logo 1", type: "FRAME", w: 300, h: 200, children: [] },
            { id: "slide-2", name: "Logo 2", type: "FRAME", w: 300, h: 200, children: [] },
            { id: "slide-3", name: "Logo 3", type: "FRAME", w: 300, h: 200, children: [] },
          ],
        },
      ],
    },
  };

  variantLinkPass(ast, { viewport: "desktop" });

  const semantics = ast.semantics || {};
  const html = autoLayoutify(ast, { semantics, wrap: false, fontMap: {} });

  assert.ok(/data-widget="slick"/i.test(html), "expected slick data-widget");
  assert.ok(/data-slick-gap="20"/i.test(html), "expected inferred gap");
  assert.ok(/data-slick-slides="3"/i.test(html), "expected inferred slides");
});
