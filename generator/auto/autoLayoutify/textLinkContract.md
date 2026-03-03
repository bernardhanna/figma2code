# Text Link Contract

`textLinkContract` is a late-stage class normalization rule applied only to nodes with:

- `intent.interactiveType === "link"`
- `intent.interactiveStyle === "text_link"`

It exists to keep generated link-style components deterministic and conflict-free after generic layout injection.

## Canonical contract

- Root link: `inline-flex items-center gap-1` (or `gap-2` when icon exists)
- No contradictory flex direction classes
- No forced full-width/centering by default
- Icon wrapper keeps `shrink-0` and explicit width

## Before / After

Before:

```txt
flex flex-col md:flex-row w-full !w-[7.6875rem] max-w-full mx-auto btn
```

After:

```txt
inline-flex items-center gap-2
```

Child text before:

```txt
w-full mx-auto justify-center
```

Child text after:

```txt
// width/centering conflicts removed; text utilities preserved
```

Icon wrapper before:

```txt
overflow-hidden w-full mx-auto
```

Icon wrapper after:

```txt
overflow-hidden shrink-0 w-[1.5rem]
```

## Notes

- Contract is scoped to text-link style links only.
- Real buttons and block CTAs are unaffected.
- This is deterministic and tunable in code (no AI heuristics at render stage).
