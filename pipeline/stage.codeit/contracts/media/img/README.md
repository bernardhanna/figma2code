# Image Media Contracts

Contracts in this directory handle image-specific transformations for responsive behavior and accessibility.

## objectContainOnSmall

**Purpose:** Ensure images use `object-contain` on small screens while preserving `object-cover` at medium+ breakpoints.

**Problem it solves:**
- Figma designs often export images with `object-cover` which crops content on small screens
- This can cut off important parts of images (faces, text, key visual elements) on mobile devices
- Without responsive overrides, the same cropping behavior applies across all breakpoints

**What it does:**
- Finds all `<img>` elements with `object-cover` class
- Adds `max-sm:object-contain` if not already present (no change if any `max-sm:object-*` exists)
- On small screens (≤640px) also removes fixed height via `max-sm:h-auto`, and when present adds `max-sm:min-h-0` and `max-sm:max-h-none` so the image can size naturally while containing
- Preserves the base `object-cover` and height utilities for larger screens

**Example transformation:**

```html
<!-- Before -->
<img class="w-full h-[23rem] object-cover">

<!-- After -->
<img class="w-full max-sm:h-auto h-[23rem] max-sm:object-contain object-cover">
```

**Safety guarantees:**
- Only targets `<img>` elements (not divs or other wrappers)
- Never overwrites explicit `max-sm:object-*` overrides
- Preserves all other classes and attributes
- Does not modify DOM structure

**When it runs:**
- During the "Code It" stage after layout normalization
- Before semantic and interactive contracts
- Registered in `stage.config.js` as `media/img/objectContainOnSmall`

**Testing:**
- Full test suite in `__tests__/objectContainOnSmall.test.js`
- Covers edge cases: self-closing tags, multiple images, existing overrides
- Run tests: `node --test pipeline/stage.codeit/contracts/__tests__/objectContainOnSmall.test.js`
