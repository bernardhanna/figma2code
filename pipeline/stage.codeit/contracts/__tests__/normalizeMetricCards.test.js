const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/cards/normalizeMetricCards");

const getClassByKey = (html, key) => {
  const tagRe = new RegExp(`<[^>]*data-key="${key}"[^>]*>`, "i");
  const tagMatch = String(html || "").match(tagRe);
  if (!tagMatch) return "";
  const cls = tagMatch[0].match(/class="([^"]*)"/i);
  return cls ? cls[1] : "";
};

test("normalizes metric card internals to vertical stack and paragraph clamp", () => {
  const html = `
    <div data-key="card" class="flex md:flex-row md:items-center gap-4 pt-4 pr-4 pb-4 pl-4">
      <div data-key="numberGroup" class="flex md:flex-row md:justify-center md:items-center border-[0.5rem] border-[rgba(0,152,216,1)] self-center">
        <h1 data-key="num" class="text-[5rem] font-[700] leading-[5.75rem] uppercase w-full max-w-[8.125rem]">&gt;19</h1>
      </div>
      <h3 data-key="title" class="text-[1.5rem] font-[600] leading-[1.625rem]">years of experience</h3>
      <p data-key="copy" class="text-[1rem] leading-[1.625rem]">We are a boutique practice, offering professional bespoke services to property owners from more than 19 years.</p>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const card = getClassByKey(out.html, "card").split(/\s+/);
  const group = getClassByKey(out.html, "numberGroup").split(/\s+/);
  const copy = getClassByKey(out.html, "copy").split(/\s+/);

  assert.ok(card.includes("flex-col"));
  assert.ok(card.includes("items-center"));
  assert.ok(card.includes("text-center"));
  assert.ok(!card.includes("md:flex-row"));

  assert.ok(group.includes("flex-col"));
  assert.ok(group.includes("border-b-8"));
  assert.ok(group.includes("border-solid"));
  assert.ok(group.some((t) => /^border-b-\[/.test(t)));
  assert.ok(!group.some((t) => /^border-\[/.test(t)));
  assert.ok(!group.includes("md:flex-row"));

  assert.ok(copy.includes("w-full"));
  assert.ok(copy.includes("max-w-[20rem]"));
});

test("leaves non-metric card untouched", () => {
  const html = `
    <div data-key="card" class="flex md:flex-row">
      <h3 data-key="title" class="text-[1.5rem] font-[600]">Overview</h3>
      <p data-key="copy" class="text-[1rem]">Short text.</p>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  const card = getClassByKey(out.html, "card");
  assert.ok(card.includes("md:flex-row"));
  assert.ok(!card.includes("text-center"));
});

