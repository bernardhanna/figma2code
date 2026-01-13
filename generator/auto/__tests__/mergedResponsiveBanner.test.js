import test from "node:test";
import assert from "node:assert/strict";

import { semanticAccessiblePass } from "../phase2SemanticPass.js";
import { mergeResponsiveFragments } from "../../auto/mergeResponsiveFragments.js";

function countMatches(str, re) {
  const m = str.match(re);
  return m ? m.length : 0;
}

test("merged responsive: semantic pass results in exactly one banner", () => {
  const rootId = "ROOT_MERGED";

  // Simulate each variant having a wrapper with a background cue + a heading
  const mobileHtml = `
<section class="m" style="background-image:url('/m.png')">
  <div data-node="${rootId}">
    <h1>Mobile</h1>
  </div>
</section>
`.trim();

  const tabletHtml = `
<section class="t" style="background-image:url('/t.png')">
  <div data-node="${rootId}">
    <h1>Tablet</h1>
  </div>
</section>
`.trim();

  const desktopHtml = `
<section class="d" style="background-image:url('/d.png')">
  <div data-node="${rootId}">
    <h1>Desktop</h1>
  </div>
</section>
`.trim();

  const merged = mergeResponsiveFragments({ mobileHtml, tabletHtml, desktopHtml });

  const ast = {
    tree: {
      id: rootId,
      name: "Hero",
      fills: [{ kind: "image" }],
      children: [],
    },
  };

  const { html: out } = semanticAccessiblePass({ html: merged, ast, semantics: {} });

  // Must be exactly one banner in merged output
  assert.equal(countMatches(out, /\brole="banner"\b/g), 1);

  // Must have exactly one aria-labelledby that points to a heading id we control
  assert.equal(countMatches(out, /\baria-labelledby="ROOT_MERGED-heading"\b/g), 1);

  // Heading id should exist somewhere in merged output
  assert.ok(/<h1\b[^>]*\bid="ROOT_MERGED-heading"\b/i.test(out));
});
