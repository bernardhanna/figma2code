import test from "node:test";
import assert from "node:assert/strict";

import { renderNode } from "../autoLayoutify/render.js";

test("empty hero media slot emits deterministic placeholder block", () => {
  const node = {
    id: "hero-slot",
    name: "Hero",
    key: "frame:hero#1",
    type: "FRAME",
    w: 768,
    h: 520,
    children: [],
  };

  const html = renderNode(node, "GRID", false, {}, { fontMap: {} });
  assert.match(html, /data-node-id="hero-slot"/);
  assert.match(html, /linear-gradient\(135deg,_rgba\(255,255,255,0.28\)_0%,_rgba\(255,255,255,0.08\)_100%\)/);
  assert.match(html, /border-\[rgba\(255,255,255,0.35\)\]/);
});

test("empty auto-layout hero media slot also emits placeholder block", () => {
  const node = {
    id: "hero-slot-auto",
    name: "Hero",
    key: "frame:hero#1",
    type: "FRAME",
    w: 768,
    h: 520,
    auto: { layout: "VERTICAL", itemSpacing: 0 },
    children: [],
  };

  const html = renderNode(node, "GRID", false, {}, { fontMap: {} });
  assert.match(html, /data-node-id="hero-slot-auto"/);
  assert.match(html, /linear-gradient\(135deg,_rgba\(255,255,255,0.28\)_0%,_rgba\(255,255,255,0.08\)_100%\)/);
});

test("empty hero slot is never rendered as interactive even with button semantic hint", () => {
  const node = {
    id: "hero-slot-sem",
    name: "Hero",
    key: "frame:hero#1",
    type: "FRAME",
    w: 768,
    h: 420,
    children: [],
  };

  const html = renderNode(node, "GRID", false, { "hero-slot-sem": { tag: "button" } }, { fontMap: {} });
  assert.doesNotMatch(html, /<button\b/i);
  assert.match(html, /linear-gradient\(135deg,_rgba\(255,255,255,0.28\)_0%,_rgba\(255,255,255,0.08\)_100%\)/);
});

test("hero media slot renders explicit img instead of interactive wrapper", () => {
  const node = {
    id: "hero-media",
    name: "Hero",
    key: "frame:hero#1",
    type: "FRAME",
    w: 768,
    h: 420,
    actions: { isClickable: true },
    img: { src: "/assets/hero-media.png" },
  };

  const html = renderNode(node, "GRID", false, { "hero-media": { tag: "button" } }, { fontMap: {} });
  assert.doesNotMatch(html, /<button\b/i);
  assert.match(html, /<img\b[^>]*src="\/assets\/hero-media\.png"/i);
});

test("auto-layout frame with CTA metadata and no explicit action stays non-interactive", () => {
  const node = {
    id: "container-no-action",
    name: "Frame 2332",
    key: "frame:frame-2332#1",
    type: "FRAME",
    w: 1024,
    h: 200,
    auto: { layout: "VERTICAL", itemSpacing: 16 },
    cta: {
      label: "A growing global movement",
      typography: { family: "Public Sans", weight: 700, sizePx: 30, lineHeightPx: 38 },
    },
    children: [
      { id: "t1", name: "Headline", type: "TEXT", text: "A growing global movement" },
      { id: "t2", name: "Subhead", type: "TEXT", text: "From Cork to London to Brighton." },
    ],
  };

  const html = renderNode(node, "VERTICAL", false, {}, { fontMap: {} });
  assert.match(html, /<div\b[^>]*data-node-id="container-no-action"/i);
  assert.doesNotMatch(html, /<button\b[^>]*data-node-id="container-no-action"/i);
});

test("container with generic clickable hint but no URL still stays non-interactive", () => {
  const node = {
    id: "container-generic-click",
    name: "Frame 2332",
    key: "frame:frame-2332#1",
    type: "FRAME",
    w: 1024,
    h: 180,
    auto: { layout: "VERTICAL", itemSpacing: 12 },
    cta: { label: "Partners" },
    actions: { isClickable: true },
    children: [
      { id: "p1", name: "Headline", type: "TEXT", text: "A growing global movement" },
      { id: "p2", name: "Subhead", type: "TEXT", text: "From Cork to London to Brighton." },
    ],
  };

  const html = renderNode(node, "VERTICAL", false, {}, { fontMap: {} });
  assert.match(html, /<div\b[^>]*data-node-id="container-generic-click"/i);
  assert.doesNotMatch(html, /<button\b[^>]*data-node-id="container-generic-click"/i);
});

test("frame-like multi-child container is never promoted to button without URL", () => {
  const node = {
    id: "frame-like-cta-container",
    name: "Frame 2332",
    key: "frame:frame-2332#1",
    type: "FRAME",
    w: 1024,
    h: 180,
    auto: { layout: "VERTICAL", itemSpacing: 12 },
    cta: { label: "Partners" },
    actions: { actionId: "click-target" },
    children: [
      { id: "c1", name: "Headline", type: "TEXT", text: "A growing global movement" },
      { id: "c2", name: "Subhead", type: "TEXT", text: "From Cork to London to Brighton." },
      { id: "c3", name: "Body", type: "TEXT", text: "Partner logos and more." },
    ],
  };

  const html = renderNode(node, "VERTICAL", false, {}, { fontMap: {} });
  assert.match(html, /<div\b[^>]*data-node-id="frame-like-cta-container"/i);
  assert.doesNotMatch(html, /<button\b[^>]*data-node-id="frame-like-cta-container"/i);
});
