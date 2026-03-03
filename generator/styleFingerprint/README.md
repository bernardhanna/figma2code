# Style Fingerprint

Deterministic style fingerprinting for interactive components.

This module computes measurable visual features from AST nodes and classifies:

- `text_link`
- `button`
- `unknown`

It is additive and safe-by-default:

- If fingerprint cannot be computed, classifier returns `unknown`.
- Existing behavior remains unchanged unless opt-in uses classifier output.

## Files

- `constants.js` - all thresholds in one place
- `fingerprint.js` - `computeStyleFingerprint(node)`
- `classifyInteractiveStyle.js` - `classifyInteractiveStyle(node)`

## Fingerprint features

- Background:
  - `hasBackgroundFill`
  - `backgroundFillType` (`solid|gradient|none`)
  - `bgOpacity`
- Stroke:
  - `hasStroke`
  - `strokeWidth`
- Corner:
  - `cornerRadius`
  - `isPillRadius`
- Padding:
  - `paddingX`
  - `paddingY`
  - source (`auto` or geometry inference)
- Child composition:
  - `hasText`
  - `hasIcon`
  - `childCount`
  - `isTextOnly`
  - `isTextPlusIcon`
- Typography (first text descendant):
  - `fontSize`
  - `fontWeight`
  - `letterSpacing`
  - `textDecoration`
  - `lineHeight`
  - `textColor`
- Size ratios:
  - `w`, `h`, `aspectRatio`
  - `textAreaRatio`
  - `paddingRatio`

## Classification

`classifyInteractiveStyle(node)` returns:

```js
{
  style: "text_link" | "button" | "unknown",
  confidence: number, // 0..1
  reason: string,     // debug summary
  fingerprint: object | null
}
```

Score-based heuristic:

- `text_link` favors:
  - text present
  - no/near-transparent background
  - low padding
  - not pill radius
  - link-like text signal (underline/text color)
  - text or text+icon composition
  - relatively small height
- `button` favors:
  - visible background fill
  - larger padding
  - pill/corner radius signal
  - text or text+icon composition
  - typical button height

If both sides are close, returns `unknown`.

## Integration (opt-in)

`resolveInteractiveIntent()` can use this classifier as an additional signal when:

- `INTERACTIVE_STYLE_FINGERPRINT=1`

Only high-confidence classifier output is applied in that path.
