Figma2Code Quality Pipeline Spec
Purpose

Produce pixel-perfect, accessible, responsive Tailwind HTML previews from Figma, with an explicit multi-stage pipeline that prioritizes perfection and repeatability over speed. The pipeline must allow incremental improvement without “post-editing” outside the system.

The system must support:

deterministic generation

deterministic cleanup/hardening

iterative AI-assisted refinement

final WordPress export packaging

Stages must remain strictly separate and communicate only through versioned artifacts + patch lists.

Core Concepts
Stages

Generate — first-pass preview generation (already near-perfect + responsive + variant-aware)

Code it — deterministic hardening (remove common layout offenders, improve semantics/a11y; no visual regressions)

Improve — iterative refinement (AI produces bounded patches, guided by evaluation until pixel-perfect)

Export — packaging only (strip instrumentation + convert to WordPress files)

Cross-cutting services

These can run after any stage:

Evaluate: objective scoring + offenders list per breakpoint

Learn: component-library comparison + suggestions (read-only unless a stage opts in)

Artifacts

Stages only read/write PipelineArtifact v1 JSON files and optional patch files.

Stage Responsibilities and Guarantees
Stage 1 — Generate

Goal: preview should already look “almost exact” at all breakpoints.

Must:

output responsive behavior (breakpoint switching stable)

apply deterministic variant linking if present/recognized (e.g., dropdown/nice-select, slider structure)

include preview instrumentation (data-node-id, data-key, etc.)

produce node index mapping: nodeId → selectors (for patch targeting)

May:

produce suboptimal class hygiene (extra wrappers, redundant width/height utilities)

Must not:

run deterministic “cleanup” contracts

remove instrumentation attributes

Output: artifact.generate.json

Stage 2 — Code it (Deterministic Hardening)

Goal: clean known class/layout issues without breaking visuals.

Must:

run deterministic contracts (ordered, scoped, testable)

improve semantics and accessibility deterministically (where safe)

keep instrumentation attributes intact

run Evaluate and record metrics

optionally run Learn to record suggestions

Visual guarantee (gate):

Code it must not regress the visual score beyond a strict tolerance.

If a contract regresses score: flag + optionally revert that contract’s changes.

Output: artifact.codeit.json

Stage 3 — Improve (Iterative Refinement)

Goal: reach pixel-perfect and finalize accessibility/robustness.

Must:

use Evaluate’s offenders list to target the worst mismatches

generate bounded patches only by default:

classAdd / classRemove / classReplace

safe aria attributes

(structural ops disabled unless explicitly enabled later)

support multiple runs (“Improve further”), storing patch iteration history

explain changes (patch reasons + deltas)

Quality guarantee (gate):

Improve must not accept patches that reduce score (unless user forces).

Output: artifact.improve.json (+ optional history/ snapshots)

Stage 4 — Export (WordPress Packaging)

Goal: convert final preview into WordPress component output without changing visuals.

Must:

strip preview-only instrumentation attributes

preserve final visuals exactly (no layout mutation)

use existing export mechanism (do not break)

Export gate:

critical a11y violations must be zero (or fail loudly)

Output: WordPress files in expected structure.

Evaluate Scoring Rubric

Evaluate runs at mobile/tablet/desktop and writes:

composite scores

per-category sub-scores

offenders list (ranked by impact)

gates / warnings

Breakpoints

mobile: 390w

tablet: 768w

desktop: design width (e.g., 1728w) or frame width

Scores (weights can be tuned later)

Visual overlay match (60–75%)

pixel diff ratio (primary)

optional SSIM-like metric (later)

mismatch regions → offenders

Layout/box model sanity (15–25%)

overflowX / clipping

fixed heights on non-media wrappers

nested conflicting widths

suspicious absolute layout usage

unstable spacing patterns

Typography integrity (10–15%)

font family/weight mismatch

size/line-height drift

wrap anomalies / truncation

Accessibility & semantics (5–10%, plus gate)

accessible names

correct interactive semantics

no nested interactive

image alt rules

heading hierarchy sanity

Stability metrics (gating, not part of score)

stage-to-stage deltas

hashes for determinism regression detection

Offenders list format (required)

Each offender record:

nodeId

breakpoint

category (visual/layout/type/a11y)

impact score

suggestedStage (codeit/improve)

suggestedContract (if deterministic)

hint (short explanation)

Patches and Live Editing
Patch sources and precedence

Rendered HTML = stage.html + patches in this order:

stage patches (e.g., Improve-generated patches)

user patches (patches.user.json)

Live editor rules

User can edit Tailwind classes and safe aria attributes only.

User cannot edit instrumentation attributes or stage metadata.

User edits are stored as patches, not raw HTML modifications.

Deterministic Contracts (Code it)
Contract principles

One rule per file

Scoped

Testable

Default to “classes-only” transforms

Report every mutation to the changes ledger

Recommended folder structure
pipeline/stage.codeit/contracts/
  layout/height/
  layout/width/
  layout/flow/
  layout/spacing/
  semantics/headings/
  semantics/interactive/
  semantics/images/
  responsive/
  utilities/ast/
  utilities/report/

Contract interface (required)

Each contract exports:

id (stable string)

apply({ html, artifact, options }) -> { html, changes[], warnings[], stats }

Changes ledger record (required)

Every change record includes:

contractId

nodeId (if known)

selector

op (classAdd/classRemove/classReplace/attrAdd/attrRemove)

value

reason

Learn Service (Component Library Alignment)

Learn compares stage output vs components library to produce:

similarity scores (dom shape + tailwind patterns)

suggestions for new deterministic contracts

optional “known-good mapping” hints

Learn is read-only by default and writes suggestions to:

artifact.diagnostics.learn[]

CLI + Preview Requirements
CLI

run a single stage: --stage generate|codeit|improve|export

run full pipeline: --stage all

writes artifacts to fixtures.out/<slug>/

Preview UI

stage selector: generate/codeit/improve

breakpoint selector: mobile/tablet/desktop

overlay opacity

offenders panel (from Evaluate)

“open live editor” (patch-based)

“Improve further” button (adds iteration)

Definition of Done

The pipeline is “ready” when:

Generate output is near-perfect at all breakpoints with variants applied.

Code it removes recurring offenders without visual regressions.
s
Improve can iteratively reach pixel-perfect using bounded patches.

Export produces WordPress output that matches the final preview exactly and strips instrumentation.

The system provides actionable reasons when score is not improving and points to the right stage/contract.s