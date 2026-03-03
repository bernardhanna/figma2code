# Visual QA + Auto-Fix Loop

Automated **Visual QA** and **class-only auto-fix** loop that improves 1:1 fidelity of generated Tailwind HTML against design reference screenshots.

## What it does

1. **Render** preview at three breakpoints (desktop, tablet, mobile) and capture screenshots.
2. **Compare** against design reference (e.g. `figma.desktop.png` in `fixtures.out/<slug>/`).
3. **Score** per breakpoint (0–1) and **cluster** offender regions from the pixel diff + DOM layout.
4. **Capture** DOM rects keyed by `data-key` / `data-node-id` → `rects-<bucket>.json`.
5. **Expected rects** from AST (design geometry) → `expected-rects.json`.
6. **Diagnose** issues (e.g. `WIDTH_MISMATCH_FULL` for a too-narrow CTA).
7. **Patch** with whitelisted class changes only (`w-full`, `block`, remove `w-fit` / `self-start` etc.).
8. **Re-run** compare and repeat until score meets threshold or budget is exhausted (rollback on regression).

## Artifacts

All written under:

- `generator/.preview/qa/<slug>/<timestamp>/`

Contents:

- `desktop.png`, `tablet.png`, `mobile.png` — render screenshots
- `diff-desktop.png`, `diff-tablet.png`, `diff-mobile.png` — pixel diff images
- `rects-desktop.json`, `rects-tablet.json`, `rects-mobile.json` — DOM bounding rects by key
- `expected-rects.json` — design-space rects from AST
- `report.json` — per-breakpoint scores, offenders, summary, and optional `aiDecisions` (when AI tie-breaker was used)
- `patches.json` — list of applied patches (for audit)

Patches applied to the preview are written to `generator/fixtures.out/<slug>/patches.json` (same format as existing refine flow).

## Running locally

1. Ensure a design reference exists for the slug, e.g.:
   - `generator/fixtures.out/<slug>/figma.desktop.png` (and optionally `figma.tablet.png`, `figma.mobile.png`),
   - or use the overlay from staged AST (`ast.meta.overlay.src`) and run compare once so it’s materialized.

2. Start the server:
   ```bash
   node generator/server.js
   ```

3. Trigger the Visual QA loop (optional mode; default preview is unchanged):
   ```bash
   curl -s -X POST "http://127.0.0.1:5173/api/visual-qa/<slug>" \
     -H "Content-Type: application/json" \
     -d '{"passDiffRatio":0.02,"maxIterations":8,"patchBudget":20}'
   ```

4. With `qaMode=1` or `refineMode=visual`: the **same** behavior is triggered by calling the above endpoint (e.g. from your UI or script). The preview page itself does not auto-run the loop unless you add a client-side call to `POST /api/visual-qa/:slug`.

## API

- **POST /api/visual-qa/:slug**  
  Runs the full Visual QA + auto-fix loop.
  - Body (optional): `passDiffRatio`, `maxIterations`, `patchBudget`
  - Returns: `{ ok, slug, stoppedReason, iterations, totalPatchCount, patchesApplied, reportPath, patchesPath, qaOutDir }`

## Issue types (v1)

- **WIDTH_MISMATCH_FULL** — Button/CTA too narrow; design or parent suggests full width. Fixes: add `w-full`, `block`, or remove `w-fit` / `inline-flex` / `self-start`.
- *STACKING_MISMATCH / TYPOGRAPHY_MISMATCH / IMAGE_FIT_MISMATCH* — Reserved for future rules.

## Adding new rules

1. In `generator/qa/diagnose.js`, add a new branch that:
   - Uses `offenderRects`, `outputRects`, `expectedRects`, `parentRects`, and optionally `layout`.
   - Pushes an issue with `issueType`, `breakpoint`, `targetKey`, `evidence`, `suggestedFixes` (bounded list), `confidence`.
2. In `generator/qa/patch.js`, only class add/remove/replace are allowed; no new ops needed for class-only rules.
3. Keep fixes **bounded** (e.g. specific Tailwind width/display classes) so the loop stays safe and deterministic.

## Optional AI tie-breaker

When diagnostics produce **≥2 plausible fix bundles with similar confidence** (within 0.15), the loop may call an AI tie-breaker **at most once per breakpoint** to choose among them.

- **AI input**: evidence (expected rects, output rects, offenders, current class list for target elements).
- **AI output**: JSON patches in the existing format only; validated for schema and class-only; at most 3 target keys (target + 2 related: parent, sibling) and 5 patches per call.
- **Guardrails**: `validatePatchSchema` and `validateClassOnly` reject malformed or non-class output; `validatePatchKeyCount` enforces key limit; invalid output falls back to the first deterministic fix. **Rollback** if the next iteration’s score worsens (unchanged from non-AI path).
- **Logging**: when AI is used or attempted, `report.json` summary includes `aiDecisions: [{ iter, breakpoint, used, reasoning, patchesSelected }]`.

Determinism and safety are preserved: AI is optional and only used as a tie-breaker within these strict boundaries.

## Constraints

- **Class-only** in v1: no tag/nesting changes, no JS.
- **Rollback** if the latest iteration makes the score worse.
- **Caps**: `maxIterations` (default 8), `patchBudget` (default 20).
- **Deterministic** when AI is disabled or when there is no tie; AI is used only for ties (≥2 similar-confidence fixes), with 1 call per breakpoint and strict validation.
