import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAiRecodeJsonStrict,
  shouldAcceptAiRecode,
  validateAiRecodeCandidate,
} from "../aiRecode.js";

test("json-only parser rejects non-JSON outputs", () => {
  const out = parseAiRecodeJsonStrict("```json\n{\"html\":\"<section></section>\"}\n```");
  assert.equal(out.ok, false);
  assert.equal(out.error, "non-json-output");
});

test("constraint validator rejects changed text or urls", () => {
  const baseline = `
    <section class="p-4">
      <a href="/contact">Contact us</a>
      <img src="/assets/hero.png" alt="Hero" />
      <p>Hello world</p>
    </section>
  `;
  const candidate = `
    <section class="p-4">
      <a href="/contact-us">Contact us</a>
      <img src="/assets/hero.png" alt="Hero" />
      <p>Hello there</p>
    </section>
  `;
  const check = validateAiRecodeCandidate({ baselineHtml: baseline, candidateHtml: candidate });
  assert.equal(check.ok, false);
  assert.ok(check.reasons.includes("changed-text-content"));
  assert.ok(check.reasons.includes("changed-src-href-urls"));
});

test("acceptance gate rejects worse diff", () => {
  const gate = shouldAcceptAiRecode({
    beforeDiff: 0.21,
    afterDiff: 0.23,
    epsilon: 0.0005,
    meaningfulDelta: 0.001,
  });
  assert.equal(gate.accept, false);
  assert.equal(gate.reason, "worsened");
});

