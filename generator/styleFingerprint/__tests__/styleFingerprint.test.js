import test from "node:test";
import assert from "node:assert/strict";

import { computeStyleFingerprint } from "../fingerprint.js";
import { classifyInteractiveStyle } from "../classifyInteractiveStyle.js";

test("text link fingerprint + classification (text+icon, no bg)", () => {
  const node = {
    id: "link-1",
    name: "Text Link",
    type: "FRAME",
    w: 140,
    h: 24,
    auto: { padL: 0, padR: 0, padT: 0, padB: 0 },
    children: [
      {
        id: "txt",
        type: "TEXT",
        w: 96,
        h: 22,
        text: {
          raw: "Find a group",
          fontSize: 16,
          lineHeightPx: 22,
          fontWeight: 700,
          decoration: "underline",
          fillHex: "#009DE6",
        },
      },
      { id: "ic", type: "VECTOR", name: "icon", w: 16, h: 16, img: { src: "/assets/icon.png" } },
    ],
  };
  const fp = computeStyleFingerprint(node);
  assert.equal(fp.hasBackgroundFill, false);
  assert.equal(fp.childComposition.isTextPlusIcon, true);

  const cls = classifyInteractiveStyle(node);
  assert.equal(cls.style, "text_link");
  assert.ok(cls.confidence >= 0.72);
});

test("button fingerprint + classification (bg + padding + radius)", () => {
  const node = {
    id: "btn-1",
    name: "Primary button",
    type: "INSTANCE",
    w: 186,
    h: 56,
    cornerRadius: 50,
    fills: [{ kind: "solid", r: 0, g: 0.62, b: 0.9, a: 1 }],
    auto: { padL: 32, padR: 32, padT: 16, padB: 16 },
    children: [{ id: "txt", type: "TEXT", w: 90, h: 22, text: { raw: "Donate now" } }],
  };
  const cls = classifyInteractiveStyle(node);
  assert.equal(cls.style, "button");
  assert.ok(cls.confidence >= 0.72);
});

test("ambiguous filled card with text resolves unknown", () => {
  const node = {
    id: "card-1",
    name: "Card",
    type: "FRAME",
    w: 320,
    h: 200,
    fills: [{ kind: "solid", r: 1, g: 1, b: 1, a: 1 }],
    children: [
      { id: "h", type: "TEXT", x: 20, y: 20, w: 150, h: 28, text: { raw: "Headline" } },
      { id: "p", type: "TEXT", x: 20, y: 56, w: 260, h: 72, text: { raw: "Body content text" } },
      { id: "img", type: "RECTANGLE", x: 20, y: 136, w: 120, h: 40 },
    ],
  };
  const cls = classifyInteractiveStyle(node);
  assert.equal(cls.style, "unknown");
});

test("pill button resolves button via isPillRadius", () => {
  const node = {
    id: "pill-1",
    name: "CTA",
    type: "INSTANCE",
    w: 180,
    h: 44,
    cornerRadius: 22,
    fills: [{ kind: "solid", r: 0.1, g: 0.2, b: 0.9, a: 1 }],
    auto: { padL: 24, padR: 24, padT: 10, padB: 10 },
    children: [{ id: "txt", type: "TEXT", text: { raw: "Get started" } }],
  };
  const cls = classifyInteractiveStyle(node);
  assert.equal(cls.style, "button");
});
