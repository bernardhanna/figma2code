const test = require("node:test");
const assert = require("node:assert/strict");
const { apply } = require("../media/img/objectContainOnSmall");

test("objectContainOnSmall: adds max-sm:object-contain + max-sm:h-auto when object-cover + fixed height present", () => {
  const input = `<img class="w-full h-[23.769375rem] object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes(
      'class="w-full max-sm:h-auto h-[23.769375rem] max-sm:object-contain object-cover"'
    )
  );
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: adds only max-sm:object-contain when no height tokens exist", () => {
  const input = `<img class="w-full object-cover">`;
  const result = apply({ html: input });
  assert.ok(result.html.includes('class="w-full max-sm:object-contain object-cover"'));
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: adds max-sm:min-h-0 when min-h-* exists", () => {
  const input = `<img class="w-full min-h-64 object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes('class="w-full max-sm:min-h-0 min-h-64 max-sm:object-contain object-cover"')
  );
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: adds max-sm:max-h-none when max-h-* exists", () => {
  const input = `<img class="w-full max-h-96 object-cover">`;
  const result = apply({ html: input });
  assert.ok(
    result.html.includes('class="w-full max-sm:max-h-none max-h-96 max-sm:object-contain object-cover"')
  );
  assert.equal(result.stats.adjusted, 1);
});

test("objectContainOnSmall: does nothing if max-sm:object-* already exists", () => {
  const input = `<img class="w-full h-[20rem] max-sm:object-contain object-cover">`;
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

test("objectContainOnSmall: does nothing if max-sm:object-fill already exists", () => {
  const input = `<img class="w-full h-64 max-sm:object-fill object-cover">`;
  const result = apply({ html: input });
  assert.equal(result.html, input);
  assert.equal(result.stats.adjusted, 0);
});

test("objectContainOnSmall: handles self-closing img tags", () => {
  const input = `<img src="test.jpg" alt="Test" class="object-cover" />`;
  const result = apply({ html: input });
  assert.ok(result.html.includes('max-sm:object-contain object-cover'));
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
      'class="w-full max-sm:h-auto h-64 max-sm:min-h-0 min-h-64 max-sm:max-h-none max-h-96 max-sm:object-contain object-cover"'
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

test("objectContainOnSmall: adds max-sm:h-auto to wrapper div when img is only child", () => {
  const input = `<div data-node-id="I481:19151;497:11897" class="flex flex-col overflow-hidden max-w-full h-[23.769375rem] self-center"><img data-node-id="I481:19151;497:11898" src="/assets/cover1_1.png" alt="Cover1 1" class="w-full h-[23.769375rem] object-cover"></div>`;
  const result = apply({ html: input });
  assert.ok(result.html.includes('max-sm:h-auto h-[23.769375rem] max-sm:object-contain object-cover'), "img has max-sm overrides");
  assert.ok(/class="[^"]*max-sm:h-auto[^"]*h-\[23\.769375rem\]/.test(result.html), "wrapper div has max-sm:h-auto before fixed height");
  assert.equal(result.stats.adjusted, 2);
});
