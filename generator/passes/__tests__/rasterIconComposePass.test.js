import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ASSETS_DIR } from "../../server/runtimePaths.js";
import { rasterIconComposePass } from "../rasterIconComposePass.js";

const PNG_1X1_RED_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z0ioAAAAASUVORK5CYII=";
const PNG_1X1_BLUE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQIBAS95xuoAAAAASUVORK5CYII=";

function writeAsset(name, b64) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const p = path.join(ASSETS_DIR, name);
  fs.writeFileSync(p, Buffer.from(b64, "base64"));
  return p;
}

test("composes raster-shard svg into one icon-composite asset image", () => {
  const a = writeAsset("vector-shard-test-a.png", PNG_1X1_RED_BASE64);
  const b = writeAsset("vector-shard-test-b.png", PNG_1X1_BLUE_BASE64);

  const ast = {
    slug: "compose-icon",
    type: "flexi_block",
    tree: {
      id: "icon",
      name: "icon",
      type: "svg",
      w: 16,
      h: 16,
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
        '<image href="/assets/vector-shard-test-a.png" x="0" y="0" width="8" height="8" preserveAspectRatio="none" />' +
        '<image href="/assets/vector-shard-test-b.png" x="8" y="8" width="8" height="8" preserveAspectRatio="none" />' +
        "</svg>",
      children: [],
    },
  };

  const out = rasterIconComposePass(ast);
  assert.equal(typeof out.tree.svg, "undefined");
  assert.equal(Boolean(out.tree.img?.src), true);
  assert.match(String(out.tree.img.src || ""), /^\/assets\/icon-composite-[a-f0-9]{12}\.svg$/);
  assert.equal(out.tree.__iconComposedImage, true);

  const composedPath = path.join(ASSETS_DIR, path.basename(out.tree.img.src));
  assert.equal(fs.existsSync(composedPath), true);
  const composed = fs.readFileSync(composedPath, "utf8");
  assert.match(composed, /data:image\/png;base64,/);

  for (const file of [a, b, composedPath]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test("optionally drops dominant background shard layer when enabled", () => {
  const bg = writeAsset("ellipse-bg-test.png", PNG_1X1_RED_BASE64);
  const fg = writeAsset("vector-fg-test.png", PNG_1X1_BLUE_BASE64);
  const prev = process.env.ICON_COMPOSE_DROP_BG_LAYER;
  process.env.ICON_COMPOSE_DROP_BG_LAYER = "1";

  const ast = {
    slug: "compose-icon-drop-bg",
    type: "flexi_block",
    tree: {
      id: "icon",
      name: "icon",
      type: "svg",
      w: 24,
      h: 24,
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<image href="/assets/ellipse-bg-test.png" x="0" y="0" width="24" height="24" preserveAspectRatio="none" />' +
        '<image href="/assets/vector-fg-test.png" x="8" y="8" width="6" height="6" preserveAspectRatio="none" />' +
        "</svg>",
      children: [],
    },
  };

  const out = rasterIconComposePass(ast);
  const composedPath = path.join(ASSETS_DIR, path.basename(String(out.tree.img?.src || "")));
  assert.equal(fs.existsSync(composedPath), true);
  const composed = fs.readFileSync(composedPath, "utf8");
  assert.doesNotMatch(composed, /ellipse-bg-test\.png/);
  assert.match(composed, /vector-fg-test\.png|data:image\/png;base64,/);

  if (typeof prev === "string") process.env.ICON_COMPOSE_DROP_BG_LAYER = prev;
  else delete process.env.ICON_COMPOSE_DROP_BG_LAYER;

  for (const file of [bg, fg, composedPath]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

