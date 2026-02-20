import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("timeline rail gets center alignment and decorative event markers", () => {
  const rail = {
    id: "time-rail",
    key: "frame:frame-2558#1/frame:time#1",
    name: "time",
    type: "FRAME",
    w: 100,
    h: 420,
    auto: { layout: "VERTICAL", itemSpacing: 0 },
    children: [
      {
        id: "line",
        key: "frame:frame-2558#1/frame:time#1/rectangle:rectangle-4734#1",
        name: "Rectangle",
        type: "RECTANGLE",
        w: 1,
        h: 420,
      },
      {
        id: "event-1",
        key: "frame:frame-2558#1/frame:time#1/frame:event#1",
        name: "event",
        type: "INSTANCE",
        w: 24,
        auto: { layout: "NONE" },
        size: {},
        actions: { isClickable: true },
        cta: { label: "2.8.2023", variant: "button" },
        children: [
          {
            id: "event-1-text",
            type: "TEXT",
            text: { raw: "2.8.2023", fontSize: 12, lineHeightPx: 18, fontWeight: 700 },
          },
        ],
      },
      {
        id: "event-2",
        key: "frame:frame-2558#1/frame:time#1/frame:event#2",
        name: "event",
        type: "INSTANCE",
        w: 24,
        auto: { layout: "NONE" },
        size: {},
        actions: { isClickable: true },
        cta: { label: "20.11.2023", variant: "button" },
        children: [
          {
            id: "event-2-text",
            type: "TEXT",
            text: { raw: "20.11.2023", fontSize: 12, lineHeightPx: 18, fontWeight: 700 },
          },
        ],
      },
      {
        id: "event-3",
        key: "frame:frame-2558#1/frame:time#1/frame:event#3",
        name: "event",
        type: "INSTANCE",
        w: 24,
        auto: { layout: "NONE" },
        size: {},
        actions: { isClickable: true },
        cta: { label: "10.4.2024", variant: "button" },
        children: [
          {
            id: "event-3-text",
            type: "TEXT",
            text: { raw: "10.4.2024", fontSize: 12, lineHeightPx: 18, fontWeight: 700 },
          },
        ],
      },
    ],
  };

  const html = renderNode(rail, "HORIZONTAL", false, {}, { fontMap: {} });
  assert.match(html, /items-center/);
  assert.match(html, /justify-between/);
  assert.match(html, /min-h-\[26\.25rem\]/);
  assert.doesNotMatch(html, /<button\b/);
  assert.match(html, /frame:time#1\/frame:event#1/);
  assert.match(html, /class="w-\[1\.5rem\] max-w-full shrink-0"/);
});
