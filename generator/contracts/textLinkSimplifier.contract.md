# Text Link Simplifier Contract

This contract is used during rendering for nodes that match:

- `node.intent.interactiveType === "link"`
- `node.intent.interactiveStyle === "text_link"`

## Purpose

Replace wrapper-heavy child trees with canonical, minimal link markup while preserving fidelity:

- preserve primary text label
- preserve first icon asset (`img` or `svg`)
- preserve root interactive styling and focus/hover behavior

## Canonical body shape

Inside the anchor, render:

1. `<span>` label (typography copied from source text node)
2. optional icon (`img`/`svg`) with `shrink-0 w-6 h-6 object-contain`

No intermediate wrapper soup (`div/p/nested span`) is emitted by this contract path.

## Fallback

If no text label is found, simplification returns `null` and the normal renderer path is used unchanged.
