"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { audit, RULES } = require("../audit");

test("audit: empty HTML returns warn", () => {
  const out = audit("");
  assert.equal(out.summary.warn, 1);
  assert.ok(out.issues.some((i) => i.rule === "empty"));
  assert.ok(out.byRule.empty === 1);
});

test("audit: button containing p reports BUTTON_STRUCTURE_NO_P_IN_BUTTON", () => {
  const html = `<button type="button"><p class="x">Label</p></button>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.BUTTON_STRUCTURE_NO_P_IN_BUTTON);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.ok(issue.message.includes("Button may not contain"));
  assert.ok(issue.snippet && issue.snippet.includes("<p"));
});

test("audit: div with btn class reports DIV_BUTTON_SHOULD_BE_BUTTON", () => {
  const html = `<div class="btn px-4 py-2">Click</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DIV_BUTTON_SHOULD_BE_BUTTON);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("audit: div with data-key instance:button reports DIV_BUTTON_SHOULD_BE_BUTTON", () => {
  const html = `<div class="rounded" data-key="instance:button">Submit</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DIV_BUTTON_SHOULD_BE_BUTTON);
  assert.ok(issue);
});

test("audit: div with btn but containing section does not report (unsafe)", () => {
  const html = `<div class="btn"><section>X</section></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DIV_BUTTON_SHOULD_BE_BUTTON);
  assert.ok(!issue);
});

test("audit: bg-cover without background-image reports BACKGROUND_INTENT_MISSING_IMAGE", () => {
  const html = `<div class="bg-cover bg-center bg-no-repeat" data-node-id="x">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.BACKGROUND_INTENT_MISSING_IMAGE);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: bg-center alone does not report BACKGROUND_INTENT_MISSING_IMAGE", () => {
  const html = `<div class="bg-center bg-slate-100">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.BACKGROUND_INTENT_MISSING_IMAGE);
  assert.ok(!issue);
});

test("audit: data-fill-type image without source does not imply BACKGROUND_INTENT_MISSING_IMAGE", () => {
  const html = `<div data-fill-type="image" class="bg-center bg-slate-100">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.BACKGROUND_INTENT_MISSING_IMAGE);
  assert.ok(!issue);
});

test("audit: data-bg-url with missing background-image reports BACKGROUND_INTENT_MISSING_IMAGE", () => {
  const html = `<div data-bg-url="https://cdn.example.com/a.jpg" class="bg-center">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.BACKGROUND_INTENT_MISSING_IMAGE);
  assert.ok(issue);
});

test("audit: w-full + w-[X] + max-w-[X] reports DUPLICATE_FIXED_WIDTH_CLASSES", () => {
  const html = `<div class="w-full w-[120px] max-w-[120px]">X</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DUPLICATE_FIXED_WIDTH_CLASSES);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: non-media div with h-[...] reports NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER", () => {
  const html = `<div class="h-[200px]">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER);
  assert.ok(issue);
});

test("audit: decorative bar nodes are ignored for NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER", () => {
  const html = `<div data-key="decorativeBarHorizontal" class="h-[0.3125rem] bg-[#ddd]"></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.NON_MEDIA_FIXED_HEIGHT_ON_WRAPPER);
  assert.ok(!issue);
});

test("audit: duplicate id reports duplicate-id error", () => {
  const html = `<div id="x">a</div><span id="x">b</span>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === "duplicate-id");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("audit: clean button has no BUTTON_STRUCTURE issue", () => {
  const html = `<button type="button"><span>Label</span></button>`;
  const out = audit(html);
  assert.ok(!out.issues.some((i) => i.rule === RULES.BUTTON_STRUCTURE_NO_P_IN_BUTTON));
});

test("audit: each issue has id, severity, rule, message", () => {
  const html = `<button><p>X</p></button>`;
  const out = audit(html);
  assert.ok(out.issues.length >= 1);
  out.issues.forEach((i) => {
    assert.ok(i.id, "id");
    assert.ok(["error", "warn", "info"].includes(i.severity), "severity");
    assert.ok(typeof i.rule === "string", "rule");
    assert.ok(typeof i.message === "string", "message");
  });
});

test("audit: byRule groups counts by rule", () => {
  const html = `<button><p>A</p></button><div class="btn">B</div>`;
  const out = audit(html);
  assert.ok(out.byRule[RULES.BUTTON_STRUCTURE_NO_P_IN_BUTTON] >= 1);
  assert.ok(out.byRule[RULES.DIV_BUTTON_SHOULD_BE_BUTTON] >= 1);
});

test("audit: duplicate data-node-id is reported as error", () => {
  const html = `<div data-node-id="x">A</div><div data-node-id="x">A</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DUPLICATE_DATA_NODE_ID);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.fatal, true);
  assert.equal(issue.duplicatedId, "x");
  assert.equal(issue.duplicateCount, 2);
  assert.ok(Array.isArray(issue.occurrences) && issue.occurrences.length === 2);
  assert.ok(typeof issue.minimalReport === "string" && issue.minimalReport.includes('data-node-id="x"'));
});

test("audit: duplicate data-key root in same top-level is fatal", () => {
  const html = `<section><div data-key="root">A</div><div data-key="root">B</div></section>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DUPLICATE_DATA_KEY_ROOT);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.fatal, true);
  assert.ok(typeof issue.minimalReport === "string" && issue.minimalReport.includes('data-key="root"'));
});

test("audit: multiple top-level roots is fatal", () => {
  const html = `<div data-key="root" class="w-full mx-auto max-w-[80rem]">A</div><div data-key="root" class="w-full mx-auto max-w-[80rem]">B</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.MULTIPLE_TOP_LEVEL_ROOTS);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.fatal, true);
});

test("audit: exact duplicate sibling block is reported", () => {
  const html = `<section><div class="a">X</div><div class="a">X</div></section>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.DUPLICATE_SIBLING_BLOCK);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("audit: grid child with w-[X] and max-w-full under grid-cols parent is reported", () => {
  const html = `<div class="grid grid-cols-1 md:grid-cols-2"><div class="w-[33.5rem] max-w-full">Col</div></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.GRID_CHILD_REDUNDANT_WIDTH);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: root with pt/pb but no responsive override is reported", () => {
  const html = `<div data-key="root" class="pt-[5rem] pb-[5rem] max-w-[80rem]">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.ROOT_PADDING_NO_RESPONSIVE_OVERRIDE);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: root with md:pt and md:pb is not reported for ROOT_PADDING", () => {
  const html = `<div data-key="root" class="pt-[2.5rem] pb-[2.5rem] md:pt-[5rem] md:pb-[5rem]">Content</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.ROOT_PADDING_NO_RESPONSIVE_OVERRIDE);
  assert.ok(!issue);
});

test("audit: overflow-hidden on div that does not wrap img/video is reported", () => {
  const html = `<div class="overflow-hidden flex flex-col"><p>Text</p></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: overflow-hidden on img wrapper is not reported", () => {
  const html = `<div class="overflow-hidden"><img src="/x.png" alt=""></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.OVERFLOW_HIDDEN_ON_NON_MEDIA_WRAPPER);
  assert.ok(!issue);
});

test("audit: conflicting responsive utility on same prop is reported", () => {
  const html = `<div class="flex flex-col md:justify-center md:items-start md:justify-start w-full"></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.CONFLICTING_RESPONSIVE_UTILITY_ON_SAME_PROP);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: grid child missing w-full when max-w-full is present is reported", () => {
  const html = `<div class="grid grid-cols-1 md:grid-cols-2"><div class="flex max-w-full h-auto">A</div></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.GRID_CHILD_MISSING_W_FULL);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: grid child self-start is reported", () => {
  const html = `<div class="grid grid-cols-2"><div class="flex w-full max-w-full self-start h-auto">A</div></div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.GRID_CHILD_SELF_START);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: button text span fixed width is reported", () => {
  const html = `<button><span class="w-[10.25rem] text-center">Book now</span></button>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.BUTTON_TEXT_SPAN_FIXED_WIDTH);
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
});

test("audit: unbalanced markup is fatal", () => {
  const html = `<div><span>Oops</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.UNBALANCED_HTML_TAGS);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.fatal, true);
});

test("audit: escaped tag boundary corruption is fatal", () => {
  const html = `<div class="w-full" data-key="root"&gt;<div class="x">Oops</div>`;
  const out = audit(html);
  const issue = out.issues.find((i) => i.rule === RULES.STRUCTURAL_CORRUPTION_ESCAPED_TAG_BOUNDARY);
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.fatal, true);
});
