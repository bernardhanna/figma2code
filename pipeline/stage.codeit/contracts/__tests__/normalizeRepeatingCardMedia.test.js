const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../layout/cards/normalizeRepeatingCardMedia");

test("unwraps rectangle:image layer in repeating item cards", () => {
  const html = `
    <div data-key="frame:4-items#1" class="flex">
      <div data-key="frame:4-items#1/frame:item#1" class="flex flex-col">
        <div data-key="frame:4-items#1/frame:item#1/frame:image#1" class="overflow-hidden rounded-[0.5rem] h-[20rem]">
          <img src="/a.jpg" alt="" class="w-full h-full object-cover" />
        </div>
      </div>
      <div data-key="frame:4-items#1/frame:item#2" class="flex flex-col">
        <div data-key="frame:4-items#1/frame:item#2/frame:image#1" class="overflow-hidden rounded-[0.5rem] h-[20rem]">
          <div data-key="frame:4-items#1/frame:item#2/frame:image#1/rectangle:image-11#1" class="w-[49.8125rem] h-[33.1875rem] bg-cover bg-no-repeat bg-center absolute inset-0 pointer-events-none">
            <img src="/b.jpg" alt="" class="object-cover" />
          </div>
        </div>
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.unwrapped, 1);
  assert.ok(!out.html.includes("rectangle:image-11#1"));
  assert.match(
    out.html,
    /data-key="frame:4-items#1\/frame:item#2\/frame:image#1"[^>]*>\s*<img[^>]*class="[^"]*w-full[^"]*h-full[^"]*rounded-\[inherit\]/
  );
});

test("does not unwrap outside repeating item context", () => {
  const html = `
    <div data-key="frame:hero#1/frame:image#1" class="overflow-hidden rounded-[0.5rem] h-[20rem]">
      <div data-key="frame:hero#1/frame:image#1/rectangle:image-11#1" class="absolute inset-0 bg-cover">
        <img src="/b.jpg" alt="" class="object-cover" />
      </div>
    </div>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.equal(out.stats.unwrapped, 0);
  assert.ok(out.html.includes("rectangle:image-11#1"));
});

