import test from "node:test";
import assert from "node:assert/strict";

import { applyContracts } from "../index.js";
import textSanityContract from "../textSanity.contract.js";

test("sanitizes corrupted label text", () => {
  const html = `<button> 0"&gt; Book now via Calendly v&gt;</button>`;
  const out = applyContracts({ html, slug: "text", contracts: [textSanityContract] });
  assert.ok(out.html.includes("<button>Book now via Calendly</button>"));
});

test("preserves clean text", () => {
  const html = `<p>Request a call</p>`;
  const out = applyContracts({ html, slug: "clean", contracts: [textSanityContract] });
  assert.equal(out.html, html);
});
