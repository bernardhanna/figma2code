# Environment Controls

Canonical reference for runtime env vars used by the generator app.

Keep this file in sync with:
- `generator/.env`
- any new `process.env.*` usage in app code (`generator/auto`, `generator/server`, `generator/templates`, `generator/passes`, `generator/contracts`, `generator/export`, `generator/config`)

Validation command:
- From `generator/`: `npm run env:check-docs`
- CI should fail if code introduces env vars that are missing from this doc.

## Core AI

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `openai` | Selects AI backend (`openai` or `gemini`). |
| `OPENAI_API_KEY` | empty | OpenAI key used when provider is `openai`. |
| `OPENAI_MODEL` | `gpt-5.2` | OpenAI model id. |
| `GEMINI_API_KEY` | empty | Gemini key used when provider is `gemini`. |
| `GEMINI_MODEL` | `gemini-1.5-pro` | Gemini model id. |
| `AI_REFINE` | `1` | Enables AI refine path in config parsing. |

## Server/Runtime

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Express bind host. |
| `PORT` | `5173` | Express port and preview base fallback. |
| `PREVIEW_BASE_URL` | `http://127.0.0.1:5173` | Absolute base URL used for overlay materialization and compare/build callbacks. |
| `NODE_ENV` | `development` | Standard runtime mode checks. |

## Pipeline Limits and Toggles

| Variable | Default | Purpose |
|---|---|---|
| `MAX_INLINE_DATA` | `200000` | Caps very large inline data blobs in AST/HTML serializers. |
| `SEMANTIC_PASS_MAX_HTML` | `2000000` | Skips semantic pass for oversized HTML. |
| `STATE_PASS_MAX_NODES` | `10000` | Safety cap for interactive state pass traversal. |
| `CONTRACTS` | `1` | Global enable/disable for Code it contracts (`0` disables). |

## Intent Graph

| Variable | Default | Purpose |
|---|---|---|
| `INTENT_GRAPH` | `1` | Enables intent graph pass (`0` disables). |
| `INTENT_GRAPH_MAX_NODES` | `15000` | Safety node cap for intent graph analysis. |

## Icon Fidelity Pipeline

| Variable | Default | Purpose |
|---|---|---|
| `ICON_ISOLATION_MAX_AREA` | `250000` | Max area threshold for icon candidate isolation. |
| `ICON_ISOLATION_DEBUG` | `0` | Logs icon-isolation and compose diagnostics when `1`. |
| `ICON_COMPOSE_DROP_BG_LAYER` | `0` | When `1`, compose pass may drop dominant background shard layer for transparent icon output. |

## Visual Python Lane (Optional)

| Variable | Default | Purpose |
|---|---|---|
| `VISUAL_PY_ENABLE` | `0` | Enables Python visual analyzer integration. |
| `VISUAL_PY_URL` | `http://127.0.0.1:8091` | Python visual service URL. |

## Widgets

| Variable | Default | Purpose |
|---|---|---|
| `WIDGET_NICESELECT` | `1` | Enables NiceSelect widget assets. |
| `WIDGET_NICESELECT_CSS` | empty | Primary NiceSelect CSS URL/path override. |
| `WIDGET_NICESELECT_CSS_FALLBACK` | empty | NiceSelect CSS fallback URL/path. |
| `WIDGET_NICESELECT_JS` | empty | Primary NiceSelect JS URL/path override. |
| `WIDGET_NICESELECT_JS_FALLBACK` | empty | NiceSelect JS fallback URL/path. |
| `WIDGET_SLICK` | `0` | Enables Slick slider widget assets. |
| `WIDGET_SLICK_CSS` | empty | Primary Slick CSS URL/path override. |
| `WIDGET_SLICK_CSS_FALLBACK` | empty | Slick CSS fallback URL/path. |
| `WIDGET_SLICK_JS` | empty | Primary Slick JS URL/path override. |
| `WIDGET_SLICK_JS_FALLBACK` | empty | Slick JS fallback URL/path. |
| `WIDGET_SLICK_JQUERY` | empty | Primary jQuery URL/path for Slick mode. |
| `WIDGET_SLICK_JQUERY_FALLBACK` | empty | jQuery fallback URL/path for Slick mode. |
| `WIDGET_SLIDER_AUTO` | `1` | Auto-detect slider widget patterns. |
| `WIDGET_SLIDER_MAX_CHILDREN` | `60` | Max children for slider auto mode. |
| `WIDGET_SLIDER_MAX_NODES` | `2500` | Max subtree nodes for slider auto mode. |
| `WIDGET_SLIDER_ALLOW_NESTED` | `0` | Allows nested slider detection when `1`. |

## Preview Editor Assets

| Variable | Default | Purpose |
|---|---|---|
| `CODEMIRROR_CSS` | empty | Override CodeMirror CSS URL used in preview shell. |
| `CODEMIRROR_JS` | empty | Override CodeMirror JS URL used in preview shell. |

## Debug Flags

| Variable | Default | Purpose |
|---|---|---|
| `AI_DEBUG_STATES` | `0` | Debug state output in AI-related flows. |
| `COMPONENT_LIB_DEBUG` | `0` | Component matcher/library debug logging. |
| `WIDGET_DEBUG` | `0` | Widget detector debug logging. |
| `EXPORT_DEBUG` | `0` | Export route debug logging. |

## Maintenance Rule

When adding or removing an env var:
1. Update `generator/.env`
2. Update this file
3. Mention the change in PR notes

