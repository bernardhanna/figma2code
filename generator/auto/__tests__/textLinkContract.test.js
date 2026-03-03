import test from "node:test";
import assert from "node:assert/strict";

import { applyTextLinkClassContract } from "../autoLayoutify/textLinkContract.js";

test("text-link root class contract removes conflicting layout utilities", () => {
  const cls = applyTextLinkClassContract({
    node: { id: "root", w: 123 },
    classString:
      "flex flex-col md:flex-row md:justify-start md:items-start gap-1 w-full !w-[7.6875rem] max-w-full mx-auto btn",
    role: "root",
    hasIcon: true,
    strictWidth: false,
  });
  assert.match(cls, /\binline-flex\b/);
  assert.match(cls, /\bitems-center\b/);
  assert.doesNotMatch(cls, /\bflex-col\b/);
  assert.doesNotMatch(cls, /\bw-full\b/);
  assert.doesNotMatch(cls, /!w-\[/);
  assert.doesNotMatch(cls, /\bmx-auto\b/);
  assert.doesNotMatch(cls, /\bbtn\b/);
});

test("text child contract removes forced width/centering", () => {
  const cls = applyTextLinkClassContract({
    node: { id: "text" },
    classString: "break-words w-full mx-auto justify-center text-left",
    role: "text",
    hasIcon: true,
  });
  assert.match(cls, /\bbreak-words\b/);
  assert.match(cls, /\btext-left\b/);
  assert.doesNotMatch(cls, /\bw-full\b/);
  assert.doesNotMatch(cls, /\bmx-auto\b/);
  assert.doesNotMatch(cls, /\bjustify-center\b/);
});

test("icon wrapper contract enforces shrink-0 + explicit width", () => {
  const cls = applyTextLinkClassContract({
    node: { id: "icon", w: 24 },
    classString: "overflow-hidden w-full mx-auto",
    role: "icon",
    hasIcon: true,
  });
  assert.match(cls, /\bshrink-0\b/);
  assert.match(cls, /\bw-6\b/);
  assert.match(cls, /\bh-6\b/);
  assert.doesNotMatch(cls, /\bw-full\b/);
  assert.doesNotMatch(cls, /\bmx-auto\b/);
});
