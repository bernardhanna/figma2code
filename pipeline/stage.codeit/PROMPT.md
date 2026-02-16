# CODE IT STAGE — Deterministic cleanup

Run deterministic contracts to normalize layout without changing the intended design.

---

## NON-NEGOTIABLE SAFETY: DO NOT BREAK ANY BUTTONS / INTERACTIVE UI

* Do not modify any `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`.
* Do not modify descendants inside those elements (no span/p text changes, no class edits).
* Do not touch preview toolbar UI ("Code it", "Improve it", "Fix pain points", etc.).
* All transformations must skip nodes that are interactive OR are inside interactive ancestors.

---

## APPLY THESE DETERMINISTIC RULES

### 1. Grid child width collapse

If parent has class `"grid"` AND any `grid-cols-*`:

* For each direct child:
  * If it has BOTH (a) a fixed width utility (`w-[...]`, `w-96`, etc.) AND (b) `max-w-full`, remove the fixed width utility.
  * Keep `w-full` if present.
* **Goal:** let grid control column sizing.

### 2. Remove overflow-hidden from non-media wrappers

* If an element has `overflow-hidden` but does NOT directly wrap an `<img>` or `<video>` (or known background-video layer), remove `overflow-hidden`.
* Keep `overflow-hidden` on media wrappers and intentional masks only.

### 3. Root responsive padding normalization

If root has `pt`/`pb` >= 5rem with no mobile override:

* Convert to: `pt-[2.5rem] pb-[2.5rem]` base.
* Add `md:pt-[<original>] md:pb-[<original>]`.
* Do not alter left/right padding tokens.

---

## DO NOT

* Do not change typography tokens.
* Do not change colors.
* Do not change DOM structure.
* Do not change heights except removing arbitrary fixed heights from non-media wrappers if you have an existing rule for it.

---

## OUTPUT

Return the updated HTML fragment only.
