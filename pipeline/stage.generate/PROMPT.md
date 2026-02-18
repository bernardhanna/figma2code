# GENERATE STAGE — Figma → initial HTML

Produce the initial Tailwind HTML from the extracted Figma nodes.

---

## NON-NEGOTIABLE SAFETY: DO NOT BREAK ANY BUTTONS / INTERACTIVE UI

* Do not modify, wrap, unwrap, replace, rename, or restyle any existing UI controls in the preview shell.
* Never change markup/classes/content of preview toolbar buttons like: "Generate", "Code it", "Improve it", "Fix pain points", etc.
* Only generate the section fragment content; do not touch the preview app chrome.

---

## OUTPUT RULES

* Use semantic tags when obvious (section/header/nav/main/footer) but do not over-guess.
* Preserve text content, fonts, colors, shadows, spacing as extracted.
* Prefer mobile-first responsive behavior: avoid fixed heights on non-media wrappers; avoid fixed widths that fight grid/flex.
* If a container is clearly a grid (grid + grid-cols-*), **DO NOT** assign fixed widths to direct grid children unless the Figma layout explicitly requires a fixed column width across all breakpoints.
* Avoid "overflow-hidden" on layout wrappers unless it's a mask for media or a known component (carousel).

---

## DO NOT

* Do not inject JS.
* Do not introduce project-specific container widths.
* Do not add fixed heights to wrappers (except media wrappers or intentional hero constraints).

---

## RESULT

Return the generated HTML fragment only.
