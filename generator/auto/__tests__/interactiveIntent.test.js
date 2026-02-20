import test from "node:test";
import assert from "node:assert/strict";

import { resolveInteractiveIntent } from "../interactiveIntent.js";

test("text-link instance resolves to link + text_link style", () => {
  const node = {
    id: "n1",
    name: "text link",
    key: "instance:text-link#1",
    type: "FRAME",
    actions: { isClickable: true },
    children: [
      { id: "t", type: "TEXT", text: { raw: "Find a group" } },
      { id: "i", type: "VECTOR", name: "icon", img: { src: "/assets/icon-a.png" } },
    ],
  };
  const intent = resolveInteractiveIntent(node);
  assert.equal(intent.interactiveType, "link");
  assert.equal(intent.interactiveStyle, "text_link");
});

test("URL action resolves to link with href", () => {
  const node = {
    id: "n2",
    name: "CTA",
    type: "INSTANCE",
    actions: { openUrl: "https://example.org" },
    children: [{ id: "t", type: "TEXT", text: { raw: "Open" } }],
  };
  const intent = resolveInteractiveIntent(node);
  assert.equal(intent.interactiveType, "link");
  assert.equal(intent.href, "https://example.org");
});

test("filled pill CTA resolves to button + button style", () => {
  const node = {
    id: "n3",
    name: "Primary Button",
    type: "INSTANCE",
    actions: { isClickable: true },
    cornerRadius: 100,
    fills: [{ kind: "solid", r: 0, g: 0.62, b: 0.9, a: 1 }],
    children: [{ id: "t", type: "TEXT", text: { raw: "Donate now" } }],
  };
  const intent = resolveInteractiveIntent(node);
  assert.equal(intent.interactiveType, "button");
  assert.equal(intent.interactiveStyle, "button");
});

test("timeline decorative event resolves to non-interactive", () => {
  const node = {
    id: "timeline-event",
    name: "event",
    key: "frame:frame-2558#1/frame:time#1/frame:event#1",
    type: "INSTANCE",
    w: 24,
    children: [{ id: "t", type: "TEXT", text: { raw: "2.8.2023" } }],
  };
  const intent = resolveInteractiveIntent(node);
  assert.equal(intent.interactiveType, "none");
  assert.equal(intent.interactiveStyle, "none");
});
