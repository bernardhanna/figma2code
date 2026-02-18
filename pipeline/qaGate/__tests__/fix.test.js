"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { audit, RULES } = require("../audit");
const { fix } = require("../fix");

test("fix: BUTTON_STRUCTURE_NO_P_IN_BUTTON -> p replaced with span", () => {
  const html = `<button type="button"><p class="font-bold">Book</p></button>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(!fixedHtml.includes("<p "), "no <p> in fixed HTML");
  assert.ok(fixedHtml.includes("<span "), "has span");
  assert.ok(fixedHtml.includes('class="font-bold"'));
  assert.ok(fixedHtml.includes("Book"));
  assert.ok(fixedHtml.includes("</span>"));

  assert.ok(appliedFixes.length >= 1);
  const openFix = appliedFixes.find((f) => f.action === "replace-p-with-span" || f.beforeSnippet?.includes("<p"));
  assert.ok(openFix);
  assert.ok(openFix.issueId);
  assert.ok(openFix.beforeSnippet?.includes("p"));
  assert.ok(openFix.afterSnippet?.includes("span"));
});

test("fix: DIV_BUTTON_SHOULD_BE_BUTTON -> div becomes button", () => {
  const html = `<div class="btn px-4" data-key="k">Label</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(fixedHtml.includes("<button "), "has button");
  assert.ok(fixedHtml.includes('type="button"'));
  assert.ok(fixedHtml.includes('class="btn px-4"'));
  assert.ok(fixedHtml.includes('data-key="k"'));
  assert.ok(fixedHtml.includes("</button>"));
  assert.ok(appliedFixes.some((f) => f.action === "div-to-button"));
});

test("fix: DUPLICATE_FIXED_WIDTH_CLASSES -> redundant w-[X] removed", () => {
  const html = `<div class="w-full w-[120px] max-w-[120px]">X</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(fixedHtml.includes("w-full"));
  assert.ok(fixedHtml.includes("max-w-[120px]"));
  assert.ok(!/(^|\s)w-\[120px\](\s|$)/.test(fixedHtml), "redundant w-[120px] token removed");
  assert.ok(appliedFixes.some((f) => f.action === "remove-redundant-w-arbitrary"));
});

test("fix: idempotent – second pass applies no further fixes", () => {
  const html = `<button><p>X</p></button>`;
  const r1 = audit(html);
  const { fixedHtml } = fix(html, r1.issues);
  const r2 = audit(fixedHtml);
  const { fixedHtml: fixedHtml2, appliedFixes: fixes2 } = fix(fixedHtml, r2.issues);

  assert.equal(fixedHtml, fixedHtml2);
  assert.equal(fixes2.length, 0);
});

test("fix: non-fixable issues leave HTML unchanged for those rules", () => {
  const html = `<div class="bg-center">No image</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.equal(appliedFixes.filter((f) => f.action !== "removeArbitraryWrapperHeights" && f.action !== "applyBackgroundFromFigmaFill").length, 0);
  assert.ok(fixedHtml.includes("bg-center"));
});

test("fix: applied fix has issueId, action, beforeSnippet, afterSnippet", () => {
  const html = `<button><p>Y</p></button>`;
  const report = audit(html);
  const { appliedFixes } = fix(html, report.issues);
  assert.ok(appliedFixes.length >= 1);
  appliedFixes.forEach((f) => {
    assert.ok(f.issueId);
    assert.ok(typeof f.action === "string");
    assert.ok(typeof f.beforeSnippet === "string");
    assert.ok(typeof f.afterSnippet === "string");
  });
});

test("fix: removes exact duplicate sibling blocks with same data-node-id", () => {
  const dup = `<div data-node-id="same" class="x"><span>One</span></div>`;
  const html = `<section>${dup}${dup}</section>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  const count = (fixedHtml.match(/data-node-id="same"/g) || []).length;
  assert.equal(count, 1);
  assert.ok(appliedFixes.some((f) => f.action === "remove-immediate-identical-duplicate"));
});

test("fix: removes exact duplicate sibling root-signature blocks even without data-node-id", () => {
  const dup = `<div class="w-full mx-auto max-w-[80rem]"><span>One</span></div>`;
  const html = `<section>${dup}${dup}</section>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  const count = (fixedHtml.match(/max-w-\[80rem\]/g) || []).length;
  assert.equal(count, 1);
  assert.ok(appliedFixes.some((f) => f.action === "remove-immediate-identical-duplicate"));
});

test("fix: GRID_CHILD_REDUNDANT_WIDTH -> removes w-[X] keeps max-w-full", () => {
  const html = `<div class="grid grid-cols-2"><div class="w-[33.5rem] max-w-full gap-4">Col</div></div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(fixedHtml.includes("max-w-full"));
  assert.ok(!/w-\[33\.5rem\]/.test(fixedHtml));
  assert.ok(appliedFixes.some((f) => f.action === "remove-grid-child-w-arbitrary"));
});

test("fix: ROOT_PADDING_NO_RESPONSIVE_OVERRIDE -> adds pt-[2.5rem] pb-[2.5rem] md:pt-[5rem] md:pb-[5rem]", () => {
  const html = `<div data-key="root" class="pt-[5rem] pb-[5rem] w-full">Content</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(fixedHtml.includes("pt-[2.5rem]"));
  assert.ok(fixedHtml.includes("pb-[2.5rem]"));
  assert.ok(fixedHtml.includes("md:pt-[5rem]"));
  assert.ok(fixedHtml.includes("md:pb-[5rem]"));
  assert.ok(appliedFixes.some((f) => f.action === "root-padding-responsive-override"));
});

test("fix: ROOT_PADDING_NO_RESPONSIVE_OVERRIDE converts tailwind scale pt-20/pb-20 to md:*-[5rem]", () => {
  const html = `<div data-key="root" class="pt-20 pb-20 w-full">Content</div>`;
  const report = audit(html);
  const { fixedHtml } = fix(html, report.issues);
  assert.ok(fixedHtml.includes("md:pt-[5rem]"));
  assert.ok(fixedHtml.includes("md:pb-[5rem]"));
  assert.ok(!fixedHtml.includes("md:pt-[20rem]"));
});

test("fix: ROOT_PADDING_NO_RESPONSIVE_OVERRIDE keeps non-hero >16rem as px bracket with warning", () => {
  const html = `<div data-key="root" class="pt-[20rem] pb-[20rem] w-full">Content</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.ok(fixedHtml.includes("md:pt-[320px]"));
  assert.ok(fixedHtml.includes("md:pb-[320px]"));
  assert.ok(appliedFixes.some((f) => f.action === "root-padding-large-nonhero-warning"));
});

test("fix: OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER -> removes overflow-hidden", () => {
  const html = `<div class="overflow-hidden flex"><span>X</span></div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(!fixedHtml.includes("overflow-hidden"));
  assert.ok(appliedFixes.some((f) => f.action === "remove-overflow-hidden"));
});

test("fix: does not remove duplicates when second does not immediately follow first", () => {
  const dup = `<div data-key="root" class="w-full mx-auto max-w-[80rem]">A</div>`;
  const html = `<section>${dup}<span>intermediate</span>${dup}</section>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  const count = (fixedHtml.match(/data-key="root"/g) || []).length;
  assert.equal(count, 2);
  assert.ok(!appliedFixes.some((f) => f.action === "remove-immediate-identical-duplicate"));
});

test("fix: integrity dedupe does not corrupt layout patch output", () => {
  const dup = `<div data-key="root" class="pt-[5rem] pb-[5rem] w-full mx-auto max-w-[80rem]"><div class="grid grid-cols-1 md:grid-cols-2"><div class="w-[33.5rem] max-w-full">Col</div></div></div>`;
  const html = `<section>${dup}${dup}</section>`;
  const report = audit(html);
  const { fixedHtml } = fix(html, report.issues);

  assert.equal((fixedHtml.match(/data-key="root"/g) || []).length, 1);
  assert.ok(!fixedHtml.includes("&gt;<div"), "no escaped tag boundary corruption");
  assert.ok(!/w-\[33\.5rem\]/.test(fixedHtml));
  assert.ok(fixedHtml.includes("md:pt-[5rem]"));
  assert.ok(fixedHtml.includes("md:pb-[5rem]"));
});

test("fix: conflicting responsive utility keeps final intended token", () => {
  const html = `<div class="flex flex-col md:justify-center md:items-start md:justify-start w-full">X</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);

  assert.ok(!fixedHtml.includes("md:justify-center"));
  assert.ok(fixedHtml.includes("md:justify-start"));
  assert.ok(fixedHtml.includes("md:items-start"));
  assert.ok(appliedFixes.some((f) => f.action === "remove-conflicting-responsive-utility"));
});

test("fix: GRID_CHILD_MISSING_W_FULL -> adds w-full before max-w-full", () => {
  const html = `<div class="grid grid-cols-2"><div class="flex max-w-full self-start h-auto">Col</div></div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.ok(fixedHtml.includes("w-full max-w-full"));
  assert.ok(appliedFixes.some((f) => f.action === "add-grid-child-w-full"));
});

test("fix: GRID_CHILD_SELF_START -> removes self-start", () => {
  const html = `<div class="grid grid-cols-2"><div class="flex w-full max-w-full self-start h-auto">Col</div></div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.ok(!fixedHtml.includes("self-start"));
  assert.ok(appliedFixes.some((f) => f.action === "remove-grid-child-self-start"));
});

test("fix: BUTTON_TEXT_SPAN_FIXED_WIDTH -> removes fixed width utilities from button text span", () => {
  const html = `<button class="px-4"><span class="w-[10.25rem] text-center font-semibold">Book now</span></button>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.ok(!/w-\[10\.25rem\]/.test(fixedHtml));
  assert.ok(fixedHtml.includes("text-center"));
  assert.ok(appliedFixes.some((f) => f.action === "remove-button-text-fixed-width"));
});

test("fix: cleanMetadata option strips data-w-rem", () => {
  const html = `<div data-w-rem="33.5rem" class="w-full">X</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues, { cleanMetadata: true });
  assert.ok(!fixedHtml.includes("data-w-rem="));
  assert.ok(appliedFixes.some((f) => f.action === "strip-design-metadata"));
});

test("fix: cleanMetadata strips known design-time metadata attributes", () => {
  const html = `<div data-node-id="n1" data-key="root" data-merged-from="x" data-w-intent="fill" data-bg-mobile="/x.jpg" data-decorative="1" class="bg-center text-white">X</div>`;
  const report = audit(html);
  const { fixedHtml } = fix(html, report.issues, { cleanMetadata: true });
  assert.ok(!fixedHtml.includes("data-node-id="));
  assert.ok(!fixedHtml.includes("data-key="));
  assert.ok(!fixedHtml.includes("data-merged-from="));
  assert.ok(!fixedHtml.includes("data-w-intent="));
  assert.ok(!fixedHtml.includes("data-bg-mobile="));
  assert.ok(fixedHtml.includes('data-decorative="1"'));
  assert.ok(fixedHtml.includes("bg-center"));
  assert.ok(fixedHtml.includes("text-white"));
});

test("fix: BACKGROUND_INTENT_MISSING_IMAGE removes only image intent classes", () => {
  const html = `<div class="bg-cover bg-no-repeat bg-center bg-slate-200">X</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.ok(!fixedHtml.includes("bg-cover"));
  assert.ok(!fixedHtml.includes("bg-no-repeat"));
  assert.ok(!fixedHtml.includes("bg-center"));
  assert.ok(fixedHtml.includes("bg-slate-200"));
  assert.ok(appliedFixes.some((f) => f.action === "resolve-background-intent-missing-image"));
});

test("fix: BACKGROUND_INTENT_MISSING_IMAGE materializes data-bg-url into background-image style", () => {
  const html = `<div class="bg-cover bg-no-repeat" data-bg-url="https://cdn.example.com/a.jpg">X</div>`;
  const report = audit(html);
  const { fixedHtml } = fix(html, report.issues);
  assert.ok(/background-image\s*:\s*url\(/.test(fixedHtml));
});

test("fix: NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER marks small decorative bars", () => {
  const html = `<div class="h-[0.3125rem] bg-[#ddd]"></div>`;
  const issues = [
    { id: "qa-NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER-1", rule: RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER, nodeIndex: 0 },
  ];
  const { fixedHtml, appliedFixes } = fix(html, issues);
  assert.ok(fixedHtml.includes('data-decorative="1"'));
  assert.ok(appliedFixes.some((f) => f.action === "mark-decorative-height-wrapper"));
});

test("fix: NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER removes large arbitrary h-[...]", () => {
  const html = `<div class="h-[200px] block">Content</div>`;
  const report = audit(html);
  const { fixedHtml, appliedFixes } = fix(html, report.issues);
  assert.ok(!fixedHtml.includes("h-[200px]"));
  assert.ok(fixedHtml.includes("block"));
  assert.ok(appliedFixes.some((f) => f.action === "remove-large-wrapper-fixed-height"));
});
