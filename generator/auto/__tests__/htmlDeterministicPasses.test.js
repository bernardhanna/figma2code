import test from "node:test";
import assert from "node:assert/strict";

import {
  injectHeroMediaByKeyPass,
  normalizeMediaSlotInteractivityPass,
  normalizeBackgroundStylePass,
  normalizeHeroLandmarkDriftPass,
  promoteSectionBgToHeroMediaPass,
  removePhantomInteractivePass,
} from "../htmlDeterministicPasses.js";

test("removePhantomInteractivePass removes empty button", () => {
  const html = `<div><button class="x" type="button"></button></div>`;
  const out = removePhantomInteractivePass(html);
  assert.equal(out, `<div></div>`);
});

test("removePhantomInteractivePass keeps icon-only button with aria-label", () => {
  const html = `<button aria-label="Open"><svg></svg></button>`;
  const out = removePhantomInteractivePass(html);
  assert.equal(out, html);
});

test("removePhantomInteractivePass keeps text button", () => {
  const html = `<button> Click </button>`;
  const out = removePhantomInteractivePass(html);
  assert.equal(out, html);
});

test("removePhantomInteractivePass removes empty anchors without meaningful href", () => {
  const html = `<div><a></a><a href="#"></a></div>`;
  const out = removePhantomInteractivePass(html);
  assert.equal(out, `<div></div>`);
});

test("removePhantomInteractivePass keeps anchor with real href", () => {
  const html = `<a href="/path"></a>`;
  const out = removePhantomInteractivePass(html);
  assert.equal(out, html);
});

test("normalizeMediaSlotInteractivityPass rewrites media slot button to div", () => {
  const html =
    `<section>` +
    `<button data-key="frame:image#1" type="button"><img src="/x.png" alt="x" /></button>` +
    `</section>`;
  const out = normalizeMediaSlotInteractivityPass(html);
  assert.match(out, /<div data-key="frame:image#1">/);
  assert.doesNotMatch(out, /<button data-key="frame:image#1"/);
  assert.match(out, /<img src="\/x\.png"/);
});

test("normalizeBackgroundStylePass converts solid gradient layer and collapses duplicates", () => {
  const html = `<section style="background-image: linear-gradient(rgba(0,157,230,1), rgba(0,157,230,1)), url('/x.png'); background-size: cover, cover; background-position: center, center; background-repeat: no-repeat, no-repeat; background-blend-mode: normal, normal;"></section>`;
  const out = normalizeBackgroundStylePass(html);
  assert.match(out, /background-color: rgba\(0,157,230,1\)/);
  assert.match(out, /background-image: url\('\/x\.png'\)/);
  assert.match(out, /background-size: cover/);
  assert.match(out, /background-position: center/);
  assert.match(out, /background-repeat: no-repeat/);
  assert.doesNotMatch(out, /background-blend-mode/);
  assert.doesNotMatch(out, /linear-gradient\(/);
});

test("normalizeBackgroundStylePass removes background-size/position/repeat when image removed", () => {
  const html = `<section style="background-image: linear-gradient(rgba(255,255,255,1), rgba(255,255,255,1)); background-size: cover; background-position: center; background-repeat: no-repeat; background-color: rgba(255,255,255,1);"></section>`;
  const out = normalizeBackgroundStylePass(html);
  assert.match(out, /background-color:\s*rgba\(255,255,255,1\)/);
  assert.doesNotMatch(out, /background-image:/);
  assert.doesNotMatch(out, /background-size:/);
  assert.doesNotMatch(out, /background-position:/);
  assert.doesNotMatch(out, /background-repeat:/);
});

test("promoteSectionBgToHeroMediaPass moves section bg url into hero media slot", () => {
  const html =
    `<section style="background-image: url('/assets/hero.png'); background-color: rgba(0,157,230,1)">` +
    `<div data-key="frame:image#1"></div>` +
    `</section>`;
  const out = promoteSectionBgToHeroMediaPass(html);
  assert.match(out, /<div data-key="frame:image#1"><img src="\/assets\/hero\.png"/);
  assert.doesNotMatch(out, /background-image:\s*url\('\/assets\/hero\.png'\)/);
});

test("injectHeroMediaByKeyPass inserts img into empty media slot", () => {
  const html = `<section><div data-key="frame:image#1"><div aria-hidden="true"></div></div></section>`;
  const out = injectHeroMediaByKeyPass(html, "/assets/hero.png", "frame:image#1");
  assert.match(out, /data-key="frame:image#1">[\s\S]*<img src="\/assets\/hero\.png"/);
});

test("normalizeHeroLandmarkDriftPass rewrites root main and hero-text header to div", () => {
  const html =
    `<section>` +
    `<main data-key="root"><header data-key="frame:hero-text-box#1" role="banner">x</header></main>` +
    `</section>`;
  const out = normalizeHeroLandmarkDriftPass(html);
  assert.match(out, /<div data-key="root">/);
  assert.match(out, /<div data-key="frame:hero-text-box#1">x<\/div>/);
  assert.doesNotMatch(out, /<main\b/);
  assert.doesNotMatch(out, /<header\b/);
  assert.doesNotMatch(out, /role="banner"/);
});

