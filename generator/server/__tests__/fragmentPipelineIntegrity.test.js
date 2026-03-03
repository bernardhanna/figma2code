import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertMergedHtmlIntegrity, renderOneFragment } from "../fragmentPipeline.js";
import { normalizeAst } from "../../auto/normalizeAst.js";
import { autoLayoutify } from "../../auto/autoLayoutify/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("integrity guard throws on duplicate root/data-node-id blocks", () => {
  const fixture = path.join(__dirname, "fixtures", "duplicatedRoots.html");
  const html = fs.readFileSync(fixture, "utf8");
  assert.throws(
    () => assertMergedHtmlIntegrity(html),
    /MERGE_INTEGRITY_DUPLICATE_DATA_NODE_ID|MERGE_INTEGRITY_DUPLICATE_ROOT_KEY/
  );
});

test("integrity guard passes for single-root document", () => {
  const html = `<section><div data-node-id="x1" data-key="root" class="w-full max-w-[80rem] mx-auto">A</div></section>`;
  assert.doesNotThrow(() => assertMergedHtmlIntegrity(html));
});

test("integrity guard throws on multiple top-level root signatures", () => {
  const html = `<div class="w-full max-w-[80rem] mx-auto">A</div><div class="w-full max-w-[80rem] mx-auto">B</div>`;
  assert.throws(
    () => assertMergedHtmlIntegrity(html),
    /MERGE_INTEGRITY_MULTIPLE_TOP_LEVEL_ROOTS/
  );
});

test("renderOneFragment runs icon and svg viewbox passes before normalizeAst", () => {
  const astInput = {
    slug: "icon-order",
    type: "flexi_block",
    tree: {
      id: "icon-root",
      name: "advocacy icon",
      type: "GROUP",
      w: 24,
      h: 24,
      children: [
        {
          id: "v1",
          name: "Vector",
          type: "VECTOR",
          w: 24,
          h: 24,
          vector: { d: "M2 12L22 12" },
          children: [],
        },
      ],
    },
  };

  let normalizeReceivedAst = null;
  const normalizeSpy = (ast) => {
    normalizeReceivedAst = ast;
    return ast;
  };

  const out = renderOneFragment({
    ast: astInput,
    normalizeAst: normalizeSpy,
    autoLayoutify: (ast) => String(ast?.tree?.svg || ""),
    semanticAccessiblePass: null,
    preventNestedInteractive: null,
    buildIntentGraph: null,
    learnedRulesPass: null,
    interactiveStatesPass: null,
    viewport: "desktop",
    previewOnly: false,
  });

  assert.ok(normalizeReceivedAst, "normalizeAst should be called");
  assert.equal(normalizeReceivedAst.tree.type, "svg");
  assert.equal(normalizeReceivedAst.tree.__lockedLayout, true);
  assert.match(
    String(normalizeReceivedAst.tree.svg || ""),
    /viewBox="0 0 24 24"/,
    "svg viewBox should be normalized before normalizeAst"
  );
  assert.match(
    String(normalizeReceivedAst.tree.svg || ""),
    /preserveAspectRatio="xMidYMid meet"/,
    "preserveAspectRatio should be normalized before normalizeAst"
  );
  assert.equal(out.ast.tree.type, "svg");
});

test("inline icon fixture: raster vector shards collapse to one composed icon image (no fixture file)", () => {
  // Intentionally inline fixture because local AST fixture files are transient during active iteration.
  const astInput = {
    slug: "icontest2-inline",
    type: "flexi_block",
    tree: {
      id: "root",
      name: "Item CTA",
      type: "FRAME",
      w: 420,
      h: 120,
      auto: {
        layout: "HORIZONTAL",
        itemSpacing: 12,
        primaryAlign: "MIN",
        counterAlign: "CENTER",
      },
      children: [
        {
          id: "cta-1",
          name: "text-link",
          type: "FRAME",
          actions: { isClickable: true },
          auto: {
            layout: "HORIZONTAL",
            itemSpacing: 8,
            primaryAlign: "MIN",
            counterAlign: "CENTER",
          },
          children: [
            {
              id: "cta-label",
              name: "Find a group",
              type: "TEXT",
              text: {
                raw: "Find a group",
                fontSize: 16,
                lineHeightPx: 22,
                fontWeight: 700,
                align: "left",
                color: { r: 1, g: 1, b: 1, a: 1 },
              },
            },
            {
              id: "cta-icon",
              name: "Icon",
              type: "GROUP",
              w: 24,
              h: 24,
              auto: { layout: "NONE" },
              children: [
                {
                  id: "shard-1",
                  name: "Vector 1",
                  type: "VECTOR",
                  relX: 1,
                  relY: 1,
                  w: 14,
                  h: 14,
                  img: { src: "/assets/vector-mltar2zv.png", w: 14, h: 14 },
                  children: [],
                },
                {
                  id: "shard-2",
                  name: "Vector 2",
                  type: "VECTOR",
                  relX: 5,
                  relY: 6,
                  w: 8,
                  h: 8,
                  img: { src: "/assets/vector-mltar303.png", w: 8, h: 8 },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const out = renderOneFragment({
    ast: astInput,
    normalizeAst,
    autoLayoutify,
    semanticAccessiblePass: null,
    preventNestedInteractive: null,
    buildIntentGraph: null,
    learnedRulesPass: null,
    interactiveStatesPass: null,
    viewport: "desktop",
    previewOnly: false,
  });

  const html = String(out.fragment || "");
  const shardImgs = html.match(/<img[^>]+src="\/assets\/vector-/gi) || [];
  assert.equal(shardImgs.length, 0, "raster vector shards should not render as flow <img> leaves");
  assert.match(
    html,
    /<img[^>]+src="\/assets\/icon-composite-[a-f0-9]{12}\.svg"/i,
    "raster shard icon should render as one composed image asset"
  );
});

test("inline icon fixture: mixed vector/ellipse shards with root auto-layout still collapse", () => {
  const astInput = {
    slug: "icontest3-inline",
    type: "flexi_block",
    tree: {
      id: "root",
      name: "Awareness item",
      type: "FRAME",
      w: 320,
      h: 120,
      children: [
        {
          id: "icon-wrap",
          name: "awareness",
          type: "INSTANCE",
          w: 32,
          h: 32,
          auto: { layout: "HORIZONTAL", itemSpacing: 1 },
          children: [
            {
              id: "v1",
              name: "Vector 1",
              type: "VECTOR",
              relX: 2,
              relY: 3,
              w: 12,
              h: 6,
              img: { src: "/assets/vector-mltb9b4v.png", w: 12, h: 6 },
              children: [],
            },
            {
              id: "e1",
              name: "Ellipse 1",
              type: "ELLIPSE",
              relX: 6,
              relY: 10,
              w: 3,
              h: 3,
              img: { src: "/assets/ellipse-mltbr781.png", w: 3, h: 3 },
              children: [],
            },
          ],
        },
      ],
    },
  };

  const out = renderOneFragment({
    ast: astInput,
    normalizeAst,
    autoLayoutify,
    semanticAccessiblePass: null,
    preventNestedInteractive: null,
    buildIntentGraph: null,
    learnedRulesPass: null,
    interactiveStatesPass: null,
    viewport: "desktop",
    previewOnly: false,
  });

  const html = String(out.fragment || "");
  const compositeImgs = html.match(/<img[^>]+src="\/assets\/icon-composite-[a-f0-9]{12}\.svg"/gi) || [];
  const vectorShardImgs = html.match(/<img[^>]+src="\/assets\/vector-/gi) || [];
  const ellipseShardImgs = html.match(/<img[^>]+src="\/assets\/ellipse-/gi) || [];

  assert.ok(compositeImgs.length >= 1, "should output at least one composed icon image");
  assert.equal(vectorShardImgs.length, 0, "vector shards should not leak as separate img leaves");
  assert.equal(ellipseShardImgs.length, 0, "ellipse shards should not leak as separate img leaves");
});

test("composed icon keeps root fill and stroke decoration when present", () => {
  const astInput = {
    slug: "icontest5-inline-style",
    type: "flexi_block",
    tree: {
      id: "root",
      name: "Icon with bg",
      type: "FRAME",
      w: 200,
      h: 100,
      children: [
        {
          id: "icon-wrap",
          name: "Icon bubble",
          type: "GROUP",
          w: 56,
          h: 56,
          fills: [{ kind: "solid", r: 0.984, g: 0.918, b: 0.369, a: 1 }], // ~#fbea5e
          stroke: { weight: 4, color: { r: 0.933, g: 0.965, b: 0.988, a: 1 } },
          children: [
            {
              id: "v1",
              name: "Vector 1",
              type: "VECTOR",
              relX: 14,
              relY: 12,
              w: 18,
              h: 14,
              img: { src: "/assets/vector-mltb9b4v.png", w: 18, h: 14 },
              children: [],
            },
            {
              id: "v2",
              name: "Vector 2",
              type: "VECTOR",
              relX: 16,
              relY: 27,
              w: 9,
              h: 8,
              img: { src: "/assets/vector-mltb9b5c.png", w: 9, h: 8 },
              children: [],
            },
          ],
        },
        {
          id: "label",
          name: "Label",
          type: "TEXT",
          text: { raw: "helper" },
          children: [],
        },
      ],
    },
  };

  const out = renderOneFragment({
    ast: astInput,
    normalizeAst,
    autoLayoutify,
    semanticAccessiblePass: null,
    preventNestedInteractive: null,
    buildIntentGraph: null,
    learnedRulesPass: null,
    interactiveStatesPass: null,
    viewport: "desktop",
    previewOnly: false,
  });

  const html = String(out.fragment || "");
  assert.match(
    html,
    /<img[^>]+src="\/assets\/icon-composite-[a-f0-9]{12}\.svg"[^>]+class="[^"]*\bbg-\[[^"]+\][^"]*"/i,
    "composed icon image should keep root background decoration"
  );
  assert.match(
    html,
    /<img[^>]+class="[^"]*(?:\boutline-\[[^"]+\]|\bborder-\[[^"]+\])[^"]*"/i,
    "composed icon image should keep root stroke decoration"
  );
  assert.match(
    html,
    /<img[^>]+class="[^"]*\brounded-[^"]*|<img[^>]+class="[^"]*\brounded-full\b/i,
    "composed icon image should keep rounded shape styling"
  );
});

test("text-link CTA renders as link with left-aligned container classes", () => {
  const astInput = {
    slug: "text-link-inline",
    type: "flexi_block",
    tree: {
      id: "root",
      name: "text-link row",
      type: "FRAME",
      w: 360,
      h: 80,
      children: [
        {
          id: "cta-node",
          key: "instance:text-link#1",
          name: "text-link",
          type: "FRAME",
          tag: "button",
          cta: { label: "Find a group", variant: "text-link" },
          actions: { isClickable: true },
          w: 123,
          h: 22,
          auto: {
            layout: "HORIZONTAL",
            itemSpacing: 4,
            primaryAlign: "MIN",
            counterAlign: "MIN",
          },
          children: [
            {
              id: "cta-inner",
              type: "FRAME",
              w: 123,
              h: 22,
              auto: {
                layout: "HORIZONTAL",
                itemSpacing: 4,
                primaryAlign: "CENTER",
                counterAlign: "CENTER",
              },
              children: [
                {
                  id: "cta-label",
                  type: "TEXT",
                  text: { raw: "Find a group", fontSize: 16, lineHeightPx: 22, fontWeight: 700 },
                },
                {
                  id: "icon-wrap",
                  name: "Icon",
                  type: "FRAME",
                  w: 24,
                  h: 24,
                  children: [
                    {
                      id: "icon-leaf",
                      type: "VECTOR",
                      name: "arrow",
                      w: 14,
                      h: 14,
                      img: { src: "/assets/icon-arrow.png", w: 14, h: 14 },
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const out = renderOneFragment({
    ast: astInput,
    normalizeAst,
    autoLayoutify,
    semanticAccessiblePass: null,
    preventNestedInteractive: null,
    buildIntentGraph: null,
    learnedRulesPass: null,
    interactiveStatesPass: null,
    viewport: "desktop",
    previewOnly: false,
  });

  const html = String(out.fragment || "");
  assert.match(html, /<a[^>]+href="#"/i, "text-link CTA should render as anchor");
  assert.match(
    html,
    /<a[^>]+class="[^"]*\binline-flex\b[^"]*\bitems-center\b/i,
    "text-link root should use canonical inline row contract"
  );
  assert.doesNotMatch(html, /<a[^>]+class="[^"]*\bflex-col\b/i, "text-link root should not keep flex-col");
  assert.doesNotMatch(html, /<a[^>]+class="[^"]*\bw-full\b/i, "text-link root should not force full width");
  assert.doesNotMatch(html, /<a[^>]+class="[^"]*!w-\[[^"]+\][^"]*"/i, "text-link root should not keep !w-[..]");
  assert.doesNotMatch(html, /<a[^>]+class="[^"]*\bmx-auto\b/i, "text-link root should not keep mx-auto");
  assert.doesNotMatch(html, /<a[^>]+class="[^"]*\bbtn\b/i, "text-link should not include btn class");
  assert.doesNotMatch(html, /<a[^>]+class="[^"]*\bpx-8\b/i, "text-link should not include button px padding");
  assert.doesNotMatch(
    html,
    /<a[^>]+class="[^"]*\brounded-\[6\.25rem\]\b/i,
    "text-link should not include pill button radius"
  );
  assert.doesNotMatch(
    html,
    /data-node-id="cta-label"[^>]+class="[^"]*(?:\bw-full\b|\bmx-auto\b)[^"]*"/i,
    "text child should not be forced full-width/centered"
  );
  assert.match(
    html,
    /<a[^>]*data-node-id="cta-node"[^>]*>[\s\S]*<(?:img|svg)\b/i,
    "text-link anchor should keep icon beside the label"
  );
  assert.doesNotMatch(
    html,
    /<p[^>]+data-node-id="cta-label"/i,
    "text-link body should not render nested paragraph wrapper"
  );
  assert.doesNotMatch(
    html,
    /<div[^>]+data-node-id="icon-wrap"/i,
    "text-link body should not render nested div icon wrapper"
  );
  assert.doesNotMatch(
    html,
    /data-node-id="icon-wrap"[^>]+class="[^"]*(?:\bw-full\b|\bmx-auto\b)[^"]*"/i,
    "icon wrapper should not be forced full-width/centered"
  );
  assert.doesNotMatch(html, /<a[^>]*>\s*<span[^>]*>\s*<p/i, "text-link should not nest paragraph tag in anchor");
  assert.doesNotMatch(
    html,
    /<a[^>]*>[\s\S]*<div[^>]*>[\s\S]*<\/div>[\s\S]*<\/a>/i,
    "text-link anchor body should avoid nested div wrappers"
  );
  assert.match(
    html,
    /<a[^>]*data-node-id="cta-node"[^>]*>\s*<span[^>]*>Find a group<\/span>\s*<(?:img|svg)\b/i,
    "text-link anchor should be canonical: span(label) then icon"
  );
  assert.doesNotMatch(
    html,
    /<a[^>]*data-node-id="cta-node"[^>]*>[\s\S]*<(?:img|svg)[^>]*class="[^"]*(?:shrink-0|h-auto|min-w-0|md:flex-1|w-full)[^"]*"/i,
    "text-link icon should not carry layout utility classes"
  );
  const ctaAnchorMatch = html.match(/<a[^>]*data-node-id="cta-node"[^>]*>([\s\S]*?)<\/a>/i);
  assert.ok(ctaAnchorMatch, "expected simplified cta anchor node");
  const inner = ctaAnchorMatch[1];
  assert.match(
    inner,
    /^\s*<span[^>]*>[^<]+<\/span>\s*(?:<img\b[^>]*\/>|<svg\b[\s\S]*<\/svg>)\s*$/i,
    "cta anchor should have exactly two direct children: span + icon"
  );
});

test("button CTA keeps button tag and button styling bundle", () => {
  const astInput = {
    slug: "button-inline",
    type: "flexi_block",
    tree: {
      id: "root",
      type: "FRAME",
      children: [
        {
          id: "cta-btn",
          key: "instance:button#1",
          name: "button",
          type: "INSTANCE",
          cta: { label: "Donate now", variant: "button" },
          actions: { isClickable: true },
          w: 186,
          h: 56,
          auto: { layout: "HORIZONTAL", itemSpacing: 8, primaryAlign: "CENTER", counterAlign: "CENTER" },
          children: [
            { id: "txt", type: "TEXT", text: { raw: "Donate now", fontSize: 16, lineHeightPx: 22, fontWeight: 700 } },
            {
              id: "btn-icon-wrap",
              type: "FRAME",
              w: 14,
              h: 14,
              children: [
                { id: "btn-icon", type: "VECTOR", name: "icon", w: 14, h: 14, img: { src: "/assets/icon-button.png", w: 14, h: 14 } },
              ],
            },
          ],
        },
      ],
    },
  };

  const out = renderOneFragment({
    ast: astInput,
    normalizeAst,
    autoLayoutify,
    semanticAccessiblePass: null,
    preventNestedInteractive: null,
    buildIntentGraph: null,
    learnedRulesPass: null,
    interactiveStatesPass: null,
    viewport: "desktop",
    previewOnly: false,
  });
  const html = String(out.fragment || "");
  assert.match(html, /<button[^>]+type="button"/i, "button CTA should render as button");
  assert.match(html, /<button[^>]+class="[^"]*\bbtn\b/i, "button CTA should keep btn class bundle");
  assert.doesNotMatch(
    html,
    /<button[^>]*data-node-id="cta-btn"[\s\S]*<(?:img|svg)[^>]*class="/i,
    "button icon should not carry class attribute"
  );
  assert.doesNotMatch(
    html,
    /data-node-id="btn-icon-wrap"[^>]*class="/i,
    "button icon wrapper should not keep layout classes"
  );
});

