import test from "node:test";
import assert from "node:assert/strict";
import { renderNode } from "../autoLayoutify/render.js";

test("metric pair node stays column on md", () => {
  const node = {
    id: "metric",
    key: "frame:key-point#1",
    name: "Metric item",
    auto: {
      layout: "HORIZONTAL",
      primaryAlign: "MIN",
      counterAlign: "MIN",
      itemSpacing: 16,
    },
    children: [
      {
        id: "n",
        key: "text:num",
        text: { raw: "43+", align: "left", fontSize: 60, lineHeightPx: 72, fontWeight: 700 },
        typography: { sizePx: 60, lineHeightPx: 72, weight: 700, colorHex: "#008fc5" },
        w: 120,
        h: 72,
      },
      {
        id: "d",
        key: "text:desc",
        text: { raw: "Groups across Ireland and expanding globally", align: "left", fontSize: 14, lineHeightPx: 20, fontWeight: 400 },
        typography: { sizePx: 14, lineHeightPx: 20, weight: 400, colorHex: "#475467" },
        w: 170,
        h: 40,
      },
    ],
  };

  const html = renderNode(node, "VERTICAL", false, {});
  assert.match(html, /\bmd:flex-col\b/);
  assert.doesNotMatch(html, /\bmd:flex-row\b/);
});
