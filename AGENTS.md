# AGENTS.md

Operational guide for Codex/agents working in `figma2wp`.

## Project layout

- Generator app root: `generator/`
- Server entrypoint: `generator/server.js`
- Core pipeline assembly: `generator/server/fragmentPipeline.js`
- Deterministic build orchestrator: `generator/server/buildOrchestrator.js`
- Visual diff/refine routes: `generator/server/routesVisualDiffAndAutofix.js`
- **Visual QA + Auto-Fix loop**: `generator/qa/` (render, diff, cluster, rects, expected, diagnose, patch, loop)
- Preview template/runtime: `generator/templates/preview.html.js` and `generator/templates/preview/*`

## Where passes live

- AST normalization + intent + semantics:
  - `generator/auto/normalizeAst.js`
  - `generator/auto/intentGraphPass.js`
  - `generator/auto/layoutIntentV2Pass.js`
  - `generator/auto/phase2SemanticPass.js`
  - `generator/auto/preventNestedInteractive.js`
- Rendering:
  - `generator/auto/autoLayoutify/index.js`
  - `generator/auto/autoLayoutify/render.js`
  - `generator/auto/autoLayoutify/layoutGridFlex.js`
  - `generator/auto/autoLayoutify/sizing.js`
- Responsive merge:
  - `generator/auto/mergeResponsiveFragments.js`

## Where fixtures/artifacts are written

- Pipeline artifacts: `fixtures.out/<slug>/artifact.generate.json`, `artifact.codeit.json`, `artifact.improve.json`
- Visual diff artifacts: `generator/fixtures.out/<slug>/` (served at `/fixtures.out/<slug>/...`)
  - `figma.*.png`, `render.*.png`, `diff.*.png`, `score.*.json`
  - `patches.json`, `patches.<bucket>.json`
  - `visual-opt-report.<bucket>.json`, `recode-report.<bucket>.json`
- Preview cache/build reports:
  - `generator/.preview/<slug>.html`
  - `generator/.preview/build-reports/<slug>.json`
- Visual QA artifacts (when running with `qaMode=1` or POST `/api/visual-qa/:slug`):
  - `generator/.preview/qa/<slug>/<timestamp>/` — report.json, patches.json, rects-*.json, diff-*.png, expected-rects.json

## Run preview locally

From repo root:

```bash
node "generator/server.js"
```

Open:

- `http://127.0.0.1:5173/preview/<slug>`

## MCP ingest (Figma → AST)

From **generator** directory, use the npm script so the CLI path resolves correctly (CLI lives at `tools/figma2code-mcp/dist/cli.js` from repo root):

```bash
cd generator && npm run mcp:build && npm run mcp:ingest -- --desktop --slug <slug> --out ./tmp/<slug>.ast.json --dry-run --verbose
```

Pass extra flags after `--` (e.g. `--url`, `--mcp`, `--post`). Do not invoke `node ../tools/figma2code-mcp/dist/cli.js` directly from the shell when cwd might not be `generator`.

## Run compare/diff

Single command example:

```bash
curl -s -X POST "http://127.0.0.1:5173/api/compare/<slug>" \
  -H "Content-Type: application/json" \
  -d '{"multi":true,"viewports":"all","passDiffRatio":0.02,"screenshot":{"mode":"element","selector":"#cmp_root","minHeight":50}}'
```

## Run Visual QA + Auto-Fix loop (class-only patches)

Optional mode; does not change default preview/generate behaviour.

```bash
curl -s -X POST "http://127.0.0.1:5173/api/visual-qa/<slug>" \
  -H "Content-Type: application/json" \
  -d '{"passDiffRatio":0.02,"maxIterations":8,"patchBudget":20}'
```

Requires design reference in `generator/fixtures.out/<slug>/figma.desktop.png` (or overlay from staged AST). See `generator/qa/README.md`.

## Run refine

Visual optimizer:

```bash
curl -s -X POST "http://127.0.0.1:5173/api/refine/<slug>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"visual-optimizer","bucket":"desktop","maxIters":3,"passDiffRatio":0.02,"topOffenders":12}'
```

AI re-code lane:

```bash
curl -s -X POST "http://127.0.0.1:5173/api/refine/<slug>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"ai-recode","bucket":"desktop","maxAttempts":2,"passDiffRatio":0.02}'
```

## Run tests

There is no single guaranteed top-level `npm test` in this repo; run targeted Node tests:

```bash
node --test "generator/auto/__tests__/layoutIntentV2Pass.test.js" \
 "generator/ai/__tests__/visualOptimizer.test.js" \
 "generator/server/__tests__/compareMetrics.test.js" \
 "generator/qa/__tests__/diagnose.test.js" \
 "generator/qa/__tests__/patch.test.js" \
 "generator/qa/__tests__/expected.test.js" \
 "generator/qa/__tests__/loop.test.js"
```

For syntax checks:

```bash
node --check "generator/server/routesVisualDiffAndAutofix.js"
```

## Guardrails

- Keep deterministic passes first; AI refinement is escalation only.
- Do not remove preview instrumentation (`data-node*`, `data-key`) in preview stages.
- Do not break export routes/files under `generator/export/`.
- SSE framing must stay spec-correct (`event:` line, `data:` line, blank line terminator).

