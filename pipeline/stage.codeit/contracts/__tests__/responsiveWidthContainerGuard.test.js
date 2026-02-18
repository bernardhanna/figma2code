const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/width/responsiveWidthContainerGuard");

const getClassByKey = (html, key) => {
  const match = String(html || "").match(new RegExp(`data-key="${key}"[^>]*class="([^"]*)"`, "i"));
  return match ? match[1].trim() : "";
};

test("section container prefers w-full + max-w + mx-auto over fixed w-[X]", () => {
  const html = `
    <section data-key="root" class="w-full w-[80rem] max-w-[80rem] px-4">
      <div>Content</div>
    </section>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const cls = getClassByKey(out.html, "root").split(/\s+/g);
  assert.ok(cls.includes("w-full"));
  assert.ok(cls.includes("max-w-[80rem]"));
  assert.ok(cls.includes("mx-auto"));
  assert.ok(!cls.includes("w-[80rem]"));
  assert.ok(out.stats.normalizedContainers >= 1);
});

test("md:flex-row with two children enforces column fill behavior", () => {
  const html = `
    <div data-key="row" class="flex flex-col md:flex-row gap-6">
      <div data-key="left" class="w-[33.5rem]">
        <div data-key="left-inner" class="w-full max-w-[20rem] mx-auto">Left</div>
      </div>
      <div data-key="right" class="w-[33.5rem]">
        <div data-key="right-inner" class="w-full max-w-[18rem]">Right</div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });

  const left = getClassByKey(out.html, "left").split(/\s+/g);
  const right = getClassByKey(out.html, "right").split(/\s+/g);
  assert.ok(left.includes("md:flex-1"));
  assert.ok(right.includes("md:flex-1"));
  assert.ok(left.includes("min-w-0"));
  assert.ok(right.includes("min-w-0"));
  assert.ok(left.includes("w-full"));
  assert.ok(right.includes("w-full"));
  assert.ok(!left.includes("w-[33.5rem]"));
  assert.ok(!right.includes("w-[33.5rem]"));
  assert.equal(out.stats.rowsEligible, 1);
  assert.equal(out.stats.guardedColumns, 2);
});

test("inner max-w caps in md columns are neutralized at md", () => {
  const html = `
    <div class="flex flex-col md:flex-row gap-6">
      <div data-key="col-a" class="w-full">
        <div data-key="cap-a" class="w-full max-w-[20rem] mx-auto">A</div>
      </div>
      <div data-key="col-b" class="w-full">
        <div data-key="cap-b" class="w-full md:max-w-[24rem]">B</div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const capA = getClassByKey(out.html, "cap-a").split(/\s+/g);
  const capB = getClassByKey(out.html, "cap-b").split(/\s+/g);

  assert.ok(capA.includes("max-w-[20rem]"));
  assert.ok(capA.includes("max-w-full"));
  assert.ok(capA.includes("md:max-w-none"));

  assert.ok(!capB.includes("md:max-w-[24rem]"));
  assert.ok(capB.includes("max-w-full"));
  assert.ok(capB.includes("md:max-w-none"));
  assert.ok(out.stats.capsDetected >= 2);
  assert.ok(out.stats.capsNeutralized >= 2);
  assert.ok(out.stats.uncappedNodes >= 2);
});

