const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../media/fill/applyBackgroundFromFigmaFill");

const buildArtifactWithNode = (node) => ({
  slug: "test",
  ast: {
    tree: {
      id: "root",
      children: [node],
    },
  },
});

test("bg-cover/bg-center + IMAGE fill adds background-image inline style", () => {
  const artifact = buildArtifactWithNode({
    id: "node-image",
    fills: [{ kind: "image", src: "/assets/bg.jpg" }],
  });
  const html = `<div data-node-id="node-image" class="bg-cover bg-center"></div>`;
  const out = apply({ html, artifact });
  assert.ok(out.html.includes("background-image"), "background-image added");
  assert.ok(out.html.includes("/assets/bg.jpg"), "image src applied");
});

test("VIDEO fill + height intent inserts video layer and wraps content", () => {
  const artifact = buildArtifactWithNode({
    id: "node-video",
    fills: [{ kind: "video", src: "/assets/hero.mp4", poster: "/assets/hero.jpg" }],
  });
  const html = `<div data-node-id="node-video" class="bg-cover h-[20rem]">
  <h2>Hero</h2>
</div>`;
  const out = apply({ html, artifact });
  assert.ok(out.html.includes("<video"), "video element injected");
  assert.ok(out.html.includes("absolute inset-0 w-full h-full object-cover"), "video covers");
  assert.ok(out.html.includes('src="/assets/hero.mp4"'), "video source set");
  assert.ok(out.html.includes('poster="/assets/hero.jpg"'), "poster set");
  assert.ok(out.html.includes('class="relative z-10"'), "content wrapper inserted");
  assert.ok(out.html.includes("Hero"), "content preserved");
  assert.ok(out.html.includes("relative"), "container gets relative");
  assert.ok(!out.html.includes("overflow-hidden"), "no overflow-hidden unless source clips");
});

test("VIDEO fill adds overflow-hidden only when source clips content", () => {
  const artifact = buildArtifactWithNode({
    id: "node-video-clip",
    clipsContent: true,
    fills: [{ kind: "video", src: "/assets/hero.mp4", poster: "/assets/hero.jpg" }],
  });
  const html = `<div data-node-id="node-video-clip" class="bg-cover h-[20rem]"><h2>Hero</h2></div>`;
  const out = apply({ html, artifact });
  assert.ok(out.html.includes("overflow-hidden"), "overflow-hidden should match clip intent");
});

test("existing background-image style is a no-op", () => {
  const artifact = buildArtifactWithNode({
    id: "node-existing",
    fills: [{ kind: "image", src: "/assets/bg.jpg" }],
  });
  const html = `<div data-node-id="node-existing" class="bg-cover" style="background-image: url('/x.png');"></div>`;
  const out = apply({ html, artifact });
  assert.equal(out.html, html, "existing background-image preserved");
});

test("decorative node is a no-op", () => {
  const artifact = buildArtifactWithNode({
    id: "node-decorative",
    fills: [{ kind: "image", src: "/assets/bg.jpg" }],
  });
  const html = `<div data-node-id="node-decorative" data-decorative="1" class="bg-cover"></div>`;
  const out = apply({ html, artifact });
  assert.equal(out.html, html, "decorative node unchanged");
});

test("VIDEO fill without poster and no height intent is a no-op", () => {
  const artifact = buildArtifactWithNode({
    id: "node-video-noheight",
    fills: [{ kind: "video", src: "/assets/hero.mp4" }],
  });
  const html = `<div data-node-id="node-video-noheight" class="bg-cover">
  <p>Small</p>
</div>`;
  const out = apply({ html, artifact });
  assert.equal(out.html, html, "no background applied without height intent");
});
