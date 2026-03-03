const test = require("node:test");
const assert = require("node:assert/strict");
const { apply } = require("../layout/cards/metricPairStack");

test("metricPairStack keeps metric wrappers vertical at md", () => {
  const html = `
  <section>
    <div data-key="root" data-w-rem="68rem" class="flex flex-col md:flex-row md:justify-start md:items-center">
      <div data-key="frame:text#1" data-w-rem="37.4375rem" class="flex flex-col md:flex-row md:flex-1">
        <div data-key="frame:text#1/frame:frame-3240#1" class="flex flex-col md:flex-row md:justify-between gap-4">
          <div data-key="root/frame:text#1/frame:frame-3240#1/frame:key-points#1/frame:frame-3239#1" class="flex flex-col md:flex-row md:justify-start md:items-start">
            <h1>43+</h1>
            <p>Groups across Ireland and expanding globally</p>
          </div>
        </div>
      </div>
      <div data-key="frame:image#1" data-w-rem="27.0625rem" class="md:flex-1"></div>
    </div>
  </section>
  `;
  const out = apply({ html });
  assert.equal(out.stats.adjusted >= 4, true);
  assert.match(out.html, /data-key="root"[^>]*md:justify-center/);
  assert.match(out.html, /data-key="root"[^>]*md:items-center/);
  assert.match(out.html, /data-key="frame:text#1"[^>]*md:basis-\[55\.055147%\]/);
  assert.match(out.html, /data-key="frame:text#1"[^>]*md:max-w-\[55\.055147%\]/);
  assert.match(out.html, /data-key="frame:image#1"[^>]*md:basis-\[39\.797794%\]/);
  assert.match(out.html, /data-key="frame:image#1"[^>]*md:max-w-\[39\.797794%\]/);
  assert.match(out.html, /data-key="frame:text#1\/frame:frame-3240#1"[^>]*md:grid-cols-3/);
  assert.match(out.html, /frame:key-points#1\/frame:frame-3239#1"[^>]*md:flex-col/);
  assert.match(out.html, /frame:key-points#1\/frame:frame-3239#1"[^>]*md:justify-start/);
  assert.match(out.html, /frame:key-points#1\/frame:frame-3239#1"[^>]*md:items-start/);
  assert.doesNotMatch(out.html, /frame:key-points#1\/frame:frame-3239#1"[^>]*md:flex-row/);
  assert.doesNotMatch(out.html, /frame:key-points#1\/frame:frame-3239#1"[^>]*md:justify-center/);
});
