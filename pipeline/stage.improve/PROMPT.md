# IMPROVE IT STAGE — AI refinement + strict guardrails

Refine the HTML to better match the Figma design across breakpoints while keeping code clean.

---

## NON-NEGOTIABLE SAFETY: DO NOT BREAK ANY BUTTONS / INTERACTIVE UI

* Do not modify any `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`.
* Do not modify their descendants (including label spans).
* Do not touch preview toolbar UI or any app shell controls (Code it / Improve it / Fix pain points).
* Skip any node that is interactive OR inside an interactive ancestor.

---

## IMPROVEMENTS TO APPLY (SAFE ONLY)

### 1. Grid/flex sanity

* Ensure grid layouts don't have competing fixed child widths.
* Prefer `max-w-full` + natural flow.

### 2. Responsive correctness

* Mobile-first: remove desktop-only rigidity (unnecessary fixed widths/heights on wrappers).
* Preserve media aspect and crop behavior (`object-cover`).

### 3. Cleanliness

* Remove duplicated width tokens (e.g., multiple `w-*` on same node).
* Avoid contradictory layout classes (e.g., `overflow-hidden` on text wrappers).
* Keep semantic correctness.

### 4. Button content rules (only if inside fragment buttons, not preview UI)

* If you find `<button><p>...</p></button>` inside the fragment, convert the `<p>` to `<span>`, preserving all classes.
* **Never** do this for preview toolbar buttons; only for generated fragment content.

---

## OUTPUT

Return the improved HTML fragment only.
