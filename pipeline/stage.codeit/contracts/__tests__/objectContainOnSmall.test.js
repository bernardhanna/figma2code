const test = require("node:test");
const assert = require("node:assert/strict");
const { apply } = require("../media/img/objectContainOnSmall");

test("objectContainOnSmall: adds max-md:object-contain + max-md:h-auto when object-cover + fixed height present", () => {
  const input = `<img class="w-full h-[23.769375rem] object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes(
      'class="w-full max-md:h-auto h-[23.769375rem] max-md:object-contain object-cover"'
    )
  );
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: adds only max-md:object-contain when no height tokens exist", () => {
  const input = `<img class="w-full object-cover">`;
  const result = apply({ html: input });
  assert.ok(result.html.includes('class="w-full max-md:object-contain object-cover"'));
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: adds max-md:min-h-0 when min-h-* exists", () => {
  const input = `<img class="w-full min-h-64 object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes('class="w-full max-md:min-h-0 min-h-64 max-md:object-contain object-cover"')
  );
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: adds max-md:max-h-none when max-h-* exists", () => {
  const input = `<img class="w-full max-h-96 object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes('class="w-full max-md:max-h-none max-h-96 max-md:object-contain object-cover"')
  );
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: does nothing if max-md:object-* already exists", () => {
  const input = `<img class="w-full h-[20rem] max-md:object-contain object-cover">`;
  const result = apply({ html: input });
  assert.equal(result.html, input);
  assert.equal(result.stats.adjusted, 0);
});

test("objectContainOnSmall: does nothing if object-cover is absent", () => {
  const input = `<img class="object-contain">`;
  const result = apply({ html: input });
  assert.equal(result.html, input);
  assert.equal(result.stats.adjusted, 0);
});

test("objectContainOnSmall: does not modify non-img tags", () => {
  const input = `<div class="object-cover"></div>`;
  const result = apply({ html: input });
  assert.equal(result.html, input);
  assert.equal(result.stats.adjusted, 0);
});

test("objectContainOnSmall: does nothing if max-md:object-fill already exists", () => {
  const input = `<img class="w-full h-64 max-md:object-fill object-cover">`;
  const result = apply({ html: input });
  assert.equal(result.html, input);
  assert.equal(result.stats.adjusted, 0);
});

test("objectContainOnSmall: handles self-closing img tags", () => {
  const input = `<img src="test.jpg" alt="Test" class="object-cover" />`;
  const result = apply({ html: input });
  assert.ok(result.html.includes('max-md:object-contain object-cover'));
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: handles img with no class attribute", () => {
  const input = `<img src="test.jpg" alt="Test">`;
  const result = apply({ html: input });
  assert.equal(result.html, input);
  assert.equal(result.stats.adjusted, 0);
});

test("objectContainOnSmall: example B ordering with h/min-h/max-h", () => {
  const input = `<img class="w-full h-64 min-h-64 max-h-96 object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes(
      'class="w-full max-md:h-auto h-64 max-md:min-h-0 min-h-64 max-md:max-h-none max-h-96 max-md:object-contain object-cover"'
    )
  );
});

test("objectContainOnSmall: idempotent run", () => {
  const input = `<img class="w-full h-[23.769375rem] object-cover">`;
  const once = apply({ html: input });
  const twice = apply({ html: once.html });
  assert.equal(twice.html, once.html);
  assert.equal(twice.stats.adjusted, 0);
});

test("objectContainOnSmall: adds max-md:h-auto to wrapper div when img is only child", () => {
  const input = `<div data-node-id="I481:19151;497:11897" class="flex flex-col overflow-hidden max-w-full h-[23.769375rem] self-center"><img data-node-id="I481:19151;497:11898" src="/assets/cover1_1.png" alt="Cover1 1" class="w-full h-[23.769375rem] object-cover"></div>`;
  const result = apply({ html: input });
  assert.ok(result.html.includes('max-md:h-auto h-[23.769375rem] max-md:object-contain object-cover'), "img has max-md overrides");
  assert.ok(/class="[^"]*max-md:h-auto[^"]*h-\[23\.769375rem\]/.test(result.html), "wrapper div has max-md:h-auto before fixed height");
  assert.equal(result.stats.adjusted, 2);
});
