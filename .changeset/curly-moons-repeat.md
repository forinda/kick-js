---
'@forinda/kickjs-cli': patch
---

Fix unbounded expansion of recursive response types in the client route map.

A type alias to an object literal (`type Node = { … }`) carries TypeScript's
anonymous `__type` symbol rather than the alias name, so the expander did not
consider it nameable and re-expanded it inline at every occurrence. For a
_recursive_ alias — zod v4's `JSONSchema`, whose `$defs` is
`Record<string, JSONSchema>`, or any condition tree — inlining cannot
terminate, and the walk fanned out exponentially.

Measured on a 1,940-route app: one route produced 8.1 million depth-guard
warnings and exhausted a 24 GB heap without emitting a map. A second route
emitted a single 7,000-character property that duplicated its subtree at every
level and still bottomed out in `unknown`. Neither is a scaling problem — both
came from individual routes.

An anonymous object type that reaches itself while being rendered now claims a
name and hoists, so the cycle terminates on that name. Recursive types are
emitted exactly, as mutually-referencing interfaces, instead of degrading:

```ts
interface __T638 { readonly all: readonly (__T638 | __T639 | __T640 | …)[] }
interface __T639 { readonly any: readonly (__T638 | __T639 | __T640 | …)[] }
interface __T640 { readonly not: __T638 | __T639 | __T640 | … }
```

On that same app: 130s / 15.5 GB / V8 abort with no output → 13.4s / 1.66 GB,
all 1,940 routes emitted, 325 depth-guard warnings → 0, longest line 7,000 →
1,644 characters. Route count, typed-response count and `any` count are
unchanged, so the fidelity is identical — only the pathological expansion is
gone.

Expansion is now also bounded as a backstop: a route that hits the depth guard
more than 1,000 times abandons its expansion, emits `unknown`, and says so
once. The depth guard was firing correctly on every one of those 8.1 million
warnings — it just never stopped, so the cost was unbounded. Finding that
meant counting the warnings to notice a single route was responsible.
