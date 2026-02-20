import test from "node:test";
import assert from "node:assert/strict";

import {
  extractTextLinkParts,
  renderTextLinkSimplifiedBody,
} from "../textLinkSimplifier.contract.js";

test("extractTextLinkParts finds primary label and first icon", () => {
  const node = {
    id: "root",
    children: [
      {
        id: "w1",
        children: [
          { id: "t1", type: "TEXT", text: { raw: "Find a group" } },
          { id: "i1", type: "VECTOR", img: { src: "/assets/icon.png" } },
        ],
      },
    ],
  };
  const parts = extractTextLinkParts(node, "");
  assert.equal(parts.labelText, "Find a group");
  assert.equal(parts.labelNode?.id, "t1");
  assert.equal(parts.iconNode?.id, "i1");
});

test("renderTextLinkSimplifiedBody returns null when no label", () => {
  const out = renderTextLinkSimplifiedBody({
    node: { id: "n", children: [{ id: "i", type: "VECTOR", img: { src: "/a.png" } }] },
    semantics: null,
    ctx: {},
    renderNode: () => '<img data-node-id="i" src="/a.png" />',
    typographyClassesFromTextNode: () => "",
    fallbackLabel: "",
  });
  assert.equal(out, null);
});

test("simplifier falls back to first icon element from rendered descendants", () => {
  const node = {
    id: "n",
    children: [
      { id: "txt", type: "TEXT", text: { raw: "Find a group" } },
      { id: "wrap", type: "FRAME", children: [{ id: "v", type: "VECTOR" }] },
    ],
  };
  const out = renderTextLinkSimplifiedBody({
    node,
    semantics: null,
    ctx: {},
    renderNode: (n) => {
      if (n.id === "wrap") return '<div><img src="/assets/icon-x.png" class="w-full" /></div>';
      return "";
    },
    typographyClassesFromTextNode: () => "",
    fallbackLabel: "",
    fallbackTypoClass: "text-[1rem] font-[700]",
  });
  assert.match(out, /<span[^>]*>Find a group<\/span>/);
  assert.match(out, /<img[^>]+src="\/assets\/icon-x\.png"/);
  assert.doesNotMatch(out, /<img[^>]+class="/i);
});

test("extractTextLinkParts reads __states.default children when children empty", () => {
  const node = {
    id: "stateful-link",
    children: [],
    __states: {
      default: {
        children: [
          { id: "t1", type: "TEXT", text: { raw: "Find a group" } },
          { id: "i1", type: "SVG", svg: "<svg></svg>" },
        ],
      },
    },
  };
  const parts = extractTextLinkParts(node, "");
  assert.equal(parts.labelText, "Find a group");
  assert.equal(parts.labelNode?.id, "t1");
  assert.equal(parts.iconNode?.id, "i1");
});
