import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { autoLayoutify } from "../autoLayoutify/index.js";

const fixturePath = path.resolve(
  process.cwd(),
  "generator/auto/__tests__/fixtures/hero-video-contract.ast.json"
);

test("hero video contract emits desktop and mobile media layers", () => {
  const ast = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const html = autoLayoutify(ast, { wrap: true });

  assert.ok(
    html.includes('class="relative flex overflow-hidden bg-center bg-no-repeat bg-cover"'),
    "hero section should receive video background contract classes"
  );
  assert.ok(html.includes('class="hidden md:block absolute inset-0"'));
  assert.ok(
    html.includes('class="object-cover absolute inset-0 w-full h-full"'),
    "desktop video layer should be absolute fill"
  );
  assert.ok(html.includes('class="relative z-20 w-full md:hidden"'));
  assert.ok(
    /class="object-cover w-full h-full min-h-\[[0-9.]+rem\]"/.test(html),
    "mobile video layer should include minimum height guard"
  );
  assert.ok(
    html.includes('src="https://cdn.example.com/video/hero.mp4"'),
    "video source should be wired"
  );
  assert.ok(
    html.includes('poster="https://cdn.example.com/video/hero-poster.jpg"'),
    "poster should be wired"
  );
  assert.equal(ast.__bgVideoUrl, "https://cdn.example.com/video/hero.mp4");
  assert.equal(ast.__bgPosterUrl, "https://cdn.example.com/video/hero-poster.jpg");
});

test("non-hero video section does not get hero video layers", () => {
  const ast = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  ast.meta.componentMatch.type = "section";
  ast.meta.figma.frameName = "generic_banner@desktop";
  ast.tree.name = "generic_banner@desktop";

  const html = autoLayoutify(ast, { wrap: true });
  assert.ok(html.includes('data-bg-type="video"'), "video metadata still emitted");
  assert.ok(!html.includes('class="hidden md:block absolute inset-0"'));
  assert.ok(!html.includes('class="relative z-20 w-full md:hidden"'));
});
