---
'@forinda/kickjs-cli': patch
---

typegen: stop the client route map's depth guard from firing on hoisted types

A real 1,940-route app emitted 34 copies of:

```text
type nesting exceeded 12 levels — emitting 'unknown'. Declare a response schema on the route for an exact type.
```

The guard bounds how deeply types nest _inline_, but it was counting through
hoists. Hoisting ends inline nesting — each named type becomes its own
top-level `interface __Tn { … }` block, referenced by name — so a chain of
named DTOs spent the whole budget on a nesting the emitted file does not
contain. It also corrupted rather than merely truncating: a 15-link chain
produced `interface __T12 { v: unknown }` where `v` was a plain `string`.

Depth now resets when a type is hoisted. On that app: 34 warnings to 0, and
the hoisted interfaces go from 10 to 86 as chains expand into their own blocks
instead of being cut off. Genuinely deep inline nesting still degrades to
`unknown`, which is what the guard is for.

The warnings also name their route now (`route 'GET /x': …`). Thirty-four
identical lines with no route between them said nothing about where to look.
