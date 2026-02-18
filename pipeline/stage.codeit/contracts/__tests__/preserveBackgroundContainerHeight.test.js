const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../media/fill/preserveBackgroundContainerHeight");

const buildArtifactWithNode = (node) => ({
  slug: "test",
  ast: {
    tree: {
      id: "root",
      children: [node],
    },
  },
});

test("background container adds h-auto + md:h-[...] for fixed height", () => {
  const artifact = buildArtifactWithNode({
    id: "bg-node",
    auto: { layout: "VERTICAL", primarySizing: "FIXED" },
    size: { h: 723 },
    fills: [{ kind: "image", src: "/assets/bg.jpg" }],
  });
  const html = `<div data-node-id="bg-node" class="bg-cover bg-center"></div>`;
  const out = apply({ html, artifact });
  assert.ok(out.html.includes("h-auto"), "h-auto added");
  assert.ok(out.html.includes("md:h-[45.1875rem]"), "md:h added with rem height");
});

test("existing md:h/min-h is a no-op", () => {
  const artifact = buildArtifactWithNode({
    id: "bg-node",
    auto: { layout: "VERTICAL", primarySizing: "FIXED" },
    size: { h: 723 },
    fills: [{ kind: "image", src: "/assets/bg.jpg" }],
  });
  const html = `<div data-node-id="bg-node" class="bg-cover md:h-[45.1875rem]"></div>`;
  const out = apply({ html, artifact });
  assert.equal(out.html, html, "no changes when md:h already present");
});

test("decorative node is a no-op", () => {
  const artifact = buildArtifactWithNode({
    id: "bg-node",
    auto: { layout: "VERTICAL", primarySizing: "FIXED" },
    size: { h: 723 },
    fills: [{ kind: "image", src: "/assets/bg.jpg" }],
  });
  const html = `<div data-node-id="bg-node" data-decorative="1" class="bg-cover bg-center"></div>`;
  const out = apply({ html, artifact });
  assert.equal(out.html, html, "decorative nodes unchanged");
});
