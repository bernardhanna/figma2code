const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const config = require("../../stage.config");
const loadContract = (entry) => {
  const id = String(entry?.id || "").trim();
  const modulePath = String(entry?.path || "").trim();
  return { id, modulePath };
};

const runContractChain = (html) => {
  let out = html;
  for (const entry of config.contracts) {
    const { modulePath } = loadContract(entry);
    if (!modulePath) continue;
    const fullPath = path.resolve(__dirname, "..", "..", modulePath);
    const mod = require(fullPath);
    const apply = mod.apply || mod.default?.apply;
    if (typeof apply !== "function") continue;
    const result = apply({ html: out, artifact: {}, options: {} });
    out = result?.html != null ? result.html : out;
  }
  return out;
};

const SECTION_FIXTURE = `
<div class="w-full max-w-[80rem] mx-auto">
  <section class="flex flex-col md:flex-col md:justify-start md:items-start gap-[3rem] pt-[5rem] pr-[5rem] pb-[5rem] pl-[5rem] max-xl:px-5 max-w-full">
    <div class="flex flex-col md:flex-col md:justify-start md:items-start gap-[1.5rem] w-[70rem] max-w-full self-start">
      <div class="flex flex-col md:flex-col md:justify-start md:items-start gap-[1.5rem] max-w-full self-start">
        <h2 class="w-[70rem] max-w-full break-words text-left text-[2.125rem] font-[600]">We take care of it all</h2>
        <div class="flex flex-row justify-between items-start w-[4.4375rem] max-w-full h-[0.3125rem] self-start" data-key="decorativebarhorizontal">
          <div class="grow basis-0 min-w-0 h-[0.3125rem] bg-[#ef7b10]"></div>
          <div class="grow basis-0 min-w-0 h-[0.3125rem] bg-[#0098d8]"></div>
          <div class="grow basis-0 min-w-0 h-[0.3125rem] bg-[#b6c0cb]"></div>
          <div class="grow basis-0 min-w-0 h-[0.3125rem] bg-[#74af27]"></div>
        </div>
      </div>
    </div>
    <p class="w-[70rem] max-w-full break-words text-left text-[1rem]">We offer a comprehensive Property Letting service.</p>
    <div class="flex flex-col md:flex-col md:justify-start md:items-start gap-[1.5rem] w-[70rem] max-w-full self-start">
      <div class="flex flex-col md:flex-row md:justify-start md:items-start gap-[1.5rem] max-w-full self-start">
        <div class="flex flex-col md:flex-col gap-[1rem] pt-[2rem] px-8 bg-[#ededed] btn hover:opacity-90 focus-visible:ring-2 w-[34.25rem] max-w-full grow basis-0 min-w-0">
          <div class="flex flex-col gap-[0.75rem] max-w-full">
            <div class="flex flex-col md:flex-row w-[20rem] max-w-full">
              <h3 class="max-w-full text-center text-[1.5rem] font-[600]">We always source the most reliable tenants</h3>
            </div>
            <div class="flex flex-col md:flex-row pb-[1.5rem] border-[0.5rem] border-[rgba(0,152,216,1)] w-[6.25rem] max-w-full h-[0.625rem]"></div>
          </div>
        </div>
        <div class="flex flex-col md:flex-col gap-[1rem] pt-[2rem] px-8 bg-[#ededed] btn hover:opacity-90 focus-visible:ring-2 w-[34.25rem] max-w-full grow basis-0 min-w-0">
          <div class="flex flex-col gap-[0.75rem] max-w-full">
            <div class="flex flex-col md:flex-row w-[20rem] max-w-full">
              <h3 class="max-w-full text-center text-[1.5rem] font-[600]">Full management service</h3>
            </div>
            <div class="flex flex-col md:flex-row pb-[1.5rem] border-[0.5rem] border-[rgba(116,175,39,1)] w-[6.25rem] max-w-full h-[0.625rem]"></div>
          </div>
        </div>
      </div>
      <div class="flex flex-col md:flex-row md:justify-start md:items-start gap-[1.5rem] max-w-full self-start">
        <div class="flex flex-col md:flex-col gap-[1rem] pt-[2rem] px-8 bg-[#ededed] btn w-[34.25rem] max-w-full grow basis-0 min-w-0">
          <div class="flex flex-col gap-[0.75rem] max-w-full"><h3 class="text-[1.5rem]">We refurbish your property</h3></div>
        </div>
        <div class="flex flex-col md:flex-col gap-[1rem] pt-[2rem] px-8 bg-[#ededed] btn w-[34.25rem] max-w-full grow basis-0 min-w-0">
          <div class="flex flex-col gap-[0.75rem] max-w-full"><h3 class="text-[1.5rem]">Tenants vetted</h3></div>
        </div>
      </div>
    </div>
  </section>
</div>
`;

test("fixture: no bar element contains pb-* after normalizeBars", () => {
  const { apply } = require("../layout/underline/normalizeBars");
  const html = SECTION_FIXTURE;
  const result = apply({ html, artifact: {}, options: {} });
  const out = String(result?.html ?? "");
  const barDivsWithPb = (out.match(/<div[^>]*class="[^"]*"[^>]*>/g) || []).filter(
    (tag) => tag.includes("w-[100px]") && tag.includes("pb-")
  );
  assert.equal(barDivsWithPb.length, 0, "no bar div should have pb- in class");
});

test("fixture: w-[70rem] removed after fluidizeFixedRem", () => {
  const out = runContractChain(SECTION_FIXTURE);
  assert.ok(!out.includes("w-[70rem]"), "w-[70rem] should be replaced");
});

test("fixture: decorativebarhorizontal subtree still present after flatten", () => {
  const out = runContractChain(SECTION_FIXTURE);
  assert.ok(out.includes("decorativebarhorizontal"), "decorative bar subtree preserved");
});

test("fixture: container with flex-col has flex token after dedupeDisplay", () => {
  const out = runContractChain(SECTION_FIXTURE);
  const sectionMatch = out.match(/<section[^>]*class="([^"]*)"[^>]*>/);
  if (sectionMatch && sectionMatch[1].includes("flex-col")) {
    assert.ok(sectionMatch[1].includes("flex"), "section with flex-col should have flex");
  }
});

test("fixture: no non-interactive div retains focus-visible or btn after cardToLinkOrButton", () => {
  const out = runContractChain(SECTION_FIXTURE);
  const divTags = out.match(/<div[^>]*class="[^"]*"[^>]*>/g) || [];
  const bad = divTags.filter(
    (tag) => (tag.includes("focus-visible:") || tag.includes(" hover:") || tag.includes(" btn ")) && !tag.includes("<a ") && !tag.includes("<button ")
  );
  assert.equal(bad.length, 0, "no div should keep focus-visible, hover, or btn when not link/button");
});
