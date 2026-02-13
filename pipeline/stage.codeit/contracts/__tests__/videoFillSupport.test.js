const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../media/videoFillSupport");

test("video-like node with data-video-url: inserts video element and wraps content with relative z-10", () => {
  const html = `<section class="flex flex-col gap-4 pt-8" data-bg-type="video" data-video-url="/assets/hero.mp4" data-poster-url="/assets/hero-poster.jpg">
  <div class="w-full max-w-[80rem]">
    <h1>Hero title</h1>
  </div>
</section>`;
  const result = apply({ html });
  assert.ok(result.html.includes('<video'), "contains video element");
  assert.ok(result.html.includes('autoplay') && result.html.includes('muted') && result.html.includes('loop'), "video has autoplay muted loop");
  assert.ok(result.html.includes('absolute inset-0 w-full h-full object-cover'), "video fills container");
  assert.ok(result.html.includes('src="/assets/hero.mp4"'), "video src set");
  assert.ok(result.html.includes('poster="/assets/hero-poster.jpg"'), "poster set");
  assert.ok(result.html.includes('relative z-10'), "content wrapper has relative z-10");
  assert.ok(result.html.includes("Hero title"), "content preserved");
  assert.equal(result.stats.adjusted, 1);
});

test("video-like node without data-video-url: inserts neutral placeholder and wraps content", () => {
  const html = `<section class="flex flex-col gap-4" data-bg-type="video">
  <p>Content</p>
</section>`;
  const result = apply({ html });
  assert.ok(!result.html.includes("<video"), "no video when no URL");
  assert.ok(result.html.includes('absolute inset-0 w-full h-full bg-[#1a1a1a]'), "neutral placeholder block");
  assert.ok(result.html.includes('relative z-10'), "content wrapper has relative z-10");
  assert.ok(result.html.includes("Content"), "content preserved");
  assert.equal(result.stats.adjusted, 1);
});

test("video-like node with data-poster-url but no data-video-url: inserts poster placeholder", () => {
  const html = `<div class="min-h-[20rem]" data-fill-type="video" data-poster-url="/poster.png">
  <span>Overlay</span>
</div>`;
  const result = apply({ html });
  assert.ok(result.html.includes("background-image"), "poster as background-image");
  assert.ok(result.html.includes("/poster.png"), "poster URL used");
  assert.ok(result.html.includes("Overlay"), "content preserved");
  assert.equal(result.stats.adjusted, 1);
});

test("node with data-media=\"video\" is detected", () => {
  const html = `<section data-media="video" data-video-url="/x.mp4"><h2>Title</h2></section>`;
  const result = apply({ html });
  assert.ok(result.html.includes("<video"), "video inserted");
  assert.ok(result.html.includes("/x.mp4"), "src set");
  assert.equal(result.stats.adjusted, 1);
});

test("idempotent: running twice does not double-inject", () => {
  const html = `<section data-bg-type="video" data-video-url="/a.mp4"><p>Text</p></section>`;
  const first = apply({ html });
  const second = apply({ html: first.html });
  assert.equal(second.html, first.html, "second run unchanged");
  assert.equal((first.html.match(/<video/g) || []).length, 1, "single video element");
});
