# Code it stage — contracts

Contracts are deterministic HTML/Tailwind rewrites run in order. Each returns `{ html, changes, warnings, stats }` and is **idempotent** (running twice yields no further diffs). The runner reports a **Fix summary** from each contract’s `stats` and the changes ledger.

---

## Contract list (run order)

### layout/classes/dedupeUtilities
Removes duplicate Tailwind class tokens on the same node. **Does not** merge or reorder classes beyond deduplication.

### layout/classes/dedupeConflictsHard
Resolves conflicting layout utilities (e.g. multiple `gap-*`, `items-*`, `justify-*`) deterministically. Prefers axis-specific gaps over generic gaps and prefers arbitrary values over standard tokens when conflicts exist. Keeps the last `items-*`/`justify-*` per breakpoint. **Does not** change non-conflicting utilities.

### layout/display/dedupeDisplay
Resolves conflicting display classes (e.g. `flex` + `inline-flex`, `grid` + `flex`) so each node has at most one display mode; adds `flex` when `flex-col`/`flex-row`/`items-*`/`justify-*` exist; canonicalizes order (display first, then flex-dir, align, gap) and dedupes tokens (e.g. duplicate gap). **Does not** change non-conflicting display or non-display classes.

### style/inline/stripRedundantInlineStyles
Removes redundant inline styles that map directly to safe Tailwind utilities (currently: `width: 100%`) and adds the equivalent class (`w-full`) if missing. **Does not** change colors, transforms, or complex inline styles.

### layout/wrappers/mergeLayoutSignature
Merges nested wrapper divs when the parent and single child share the same layout signature (display, direction, gap, width constraints) and have no unique semantics. Preserves design-time `data-key="instance:*"` and `data-key="frame:*"` wrappers only when safe. **Does not** merge wrappers with padding, margin, background, border, or semantic attributes.

### layout/container/addMxAuto
Adds `mx-auto` to nodes that have `w-full` and a `max-w-*` but lack horizontal centering. **Does not** change width values or add other layout classes.

### layout/height/removeFixedHeights
Removes or relaxes fixed height classes where safe (e.g. with `data-h-intent` or when redundant). Card containers (bg + padding) are allowed to shed `min-h`/`h` unless they are media/hero wrappers or contain absolute inset layers. **Does not** remove heights that are required for layout or design.

### layout/underline/normalizeBars
Detects bar elements (width ~60–140px or w-[6.25rem], height 6–14px or border, with color) used as underlines/markers—under headings or inside cards. Removes **all** padding and layout/container classes from the bar; defaults to a filled rectangle `w-[100px] h-[10px] bg-[color]`. Only uses border-only `w-[100px] border-b-[10px] border-b-[color]` when explicit stroke hints exist. Skips bars already in canonical form. **Does not** touch non-bar dividers or elements that don’t match the size/color heuristics.

### layout/width/fluidizeFixedRem
Replaces rigid rem widths with fluid rules: `w-[70rem] max-w-full` → `w-full`; card inner wrappers (w-[34.25rem] or w-[30.25rem] + max-w-full without grow/basis) → `w-full` + `max-w-[...]`; card widths with grow/basis → `flex-1` or `w-full md:w-1/2`; heading `w-[20rem]` → `max-w-[20rem]`. **Does not** change max-widths that are not part of these patterns or invent new widths.

### layout/width/dedupeWidths
Removes redundant child width tokens when the parent already controls width and the child has `max-w-full`. **Does not** remove widths when the parent has no width control.

### layout/width/enforceWidthIntent
Ensures `data-w-intent="fixed"` always corresponds to an explicit width constraint. If `data-w-rem`/`data-w-px` exists, it enforces `w-[…]` and removes conflicting base width constraints while preserving responsive overrides. Decorative bars keep fixed width. If no numeric width exists, it rewrites intent to `fill` and applies `w-full max-w-full`, except for allowed media/hero exceptions. **Does not** alter nodes that already match their intent.

### layout/width/innerWrapperFixedWidthToMax
For non-media wrapper elements inside responsive containers, replaces base `w-[X]` with `w-full max-w-[X]` while preserving `max-w-full` if present. Skips root containers, media wrappers, horizontal scroll tracks, and absolutely positioned elements. **Does not** change height utilities, data attributes, or any non-width classes.

### layout/width/widthRedundancyCollapseContract
Removes redundant width constraints on a node when an ancestor already enforces an equivalent or stricter max width for the same breakpoint. Only deletes `max-w-*` and redundant `w-[X]` when an ancestor has the same fixed width. Skips media elements and media wrappers. **Does not** add new classes or alter non-width utilities.

### layout/text/textFixedWidthGuardContract
For semantic text nodes, replaces base `w-[Xrem]`/`w-[Xpx]` with `w-full max-w-[X] max-w-full` to prevent horizontal overflow while preserving desktop width. Skips fixed/absolute positioned nodes and text inside horizontal scroll contexts. **Does not** touch non-text elements or typography tokens.

### layout/section/enforceMobileVerticalPadding
Ensures root sections use `pt-[2.5rem] pb-[2.5rem]` on mobile, while preserving original vertical padding at `md+` via `md:pt-*`/`md:pb-*`. Only applies to section roots (data-key="root" or top-level sections). **Does not** change horizontal padding or non-root sections.

### layout/text/nowrapGuard
Removes `whitespace-nowrap` where it causes clipping: constrained headings/text blocks and card containers. Keeps nowrap on small badge-like labels. **Does not** alter text content or other typography tokens.

### layout/text/shrinkGuard
Removes `shrink-0` from text elements when wrapping is allowed (break-words or pre-wrap) to avoid mobile clipping. Keeps `shrink-0` for deliberate no-wrap labels inside flex rows. **Does not** affect non-text elements.

### layout/align/centerCardContent
Adds base `items-center` on card containers when they already center content at md+ and have centered text descendants. Skips when explicit base `items-start` exists. **Does not** change typography or text alignment.

### layout/grid/upgradeToGridForMatrices
Detects a 2×2 card matrix: outer flex-col with gap, two row wrappers (each md:flex-row with gap), each with two card children (flex-1/basis-0/grow). Replaces the two row wrappers with a single **grid** container: `grid grid-cols-1 md:grid-cols-2` and the same gap; the four cards become direct children. **Does not** change other flex layouts or grids that don’t match this pattern.

### layout/layoutModel/inferGridFromRepeatingCards
Detects repeating card layouts (shared background + padding) and converts them to a 2-column grid when safe. Flattens row wrappers that exist solely for flex-row layout and preserves the existing gap value. **Does not** touch non-card groups or containers without stable gaps.

### layout/grid/stripFlexChildSizing
When a parent is a grid container, removes flex-only sizing hints (`flex-1`, `grow`, `basis-*`, `self-center`) from its direct children. Keeps `min-w-0` only when the child is itself a flex container with overflow/truncation utilities. **Does not** remove internal layout classes (e.g. `flex flex-col`) from grid children.

### layout/wrappers/flattenRedundant
Removes redundant wrapper divs (empty or allowlist-only classes, single child, no id/role/aria/data-key/data-node-id). Merges allowlist classes into the kept child. **Does not** remove divs with padding, margin, gap, bg, border, flex/grid, or semantic/identifying attributes. **Does not** flatten nodes with `data-decorative="1"` or whose `data-key` contains `decorativebar`, or any node that has decorative content in its subtree.

### layout/cleanup/previewNormalize
Late-stage cleanup pass for final HTML: collapses redundant div wrappers with a single child when they have no unique semantics and only movable layout classes; merges data-* attributes onto the surviving child. Also removes duplicate classes, redundant responsive duplicates (e.g. `items-center md:items-center`), and drops `max-w-full` when a specific `max-w-[…]` exists. State variants (hover/focus/active/aria/data-*) and transition/ring/outline utilities are preserved unchanged; state classes from data attributes are appended when present. **Does not** remove or alter interactive/transition variants.

### semantics/landmarks/upgradeLandmarks
Upgrades landmark divs to semantic tags (e.g. `main`, `nav`, `section`) when appropriate. **Does not** change non-landmark structure or strip existing landmarks.

### semantics/interactive/cardToLinkOrButton
If a div has interactive affordances (hover:*, focus-visible:*, cursor-pointer, btn, ring), either upgrades it (hoist single `<a href>` to outer link, or convert to button when there is click evidence in data attributes) or strips those affordances. **Does not** invent links or buttons without href or clear data-action/data-click.

### semantics/interactive/preventNestedInteractive
Demotes nested interactive elements (e.g. button inside link) to divs and strips interactive attributes to avoid a11y violations. **Does not** change structure when there is no nested interactive.

### layout/section/containerNormalize
When a div with `w-full` and `max-w-*` directly wraps a single `<section>`, swaps them so the section is outer and a single inner div gets the canonical container classes (`w-full max-w-[80rem] mx-auto`). Also unwraps the pattern `<section> <div class="w-full max-w-*"> <section> ...` by merging the inner section’s classes/attributes into the container div. Preserves section-level padding/bg from the wrapper on the section. **Does not** change sections that are not wrapped by such a div or that have multiple siblings.
