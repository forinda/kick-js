---
'@forinda/kickjs': minor
---

feat(reactivity): `ref()` and `computed()` auto-unwrap on `JSON.stringify`

Both `ref()` and `computed()` now implement `toJSON()` returning their current `value`. This means refs serialise transparently inside larger JSON payloads — adopters who keep adapter / plugin state in refs and surface it via `introspect()` no longer need to `.value`-unwrap manually at every call site:

```ts
// Before — manual unwrap:
introspect() {
  return {
    state: {
      connectedAt: this.connectedAt.value, // .value everywhere
      activeConnections: this.activeConnections.value,
    },
  }
}

// After — refs serialise as their value:
introspect() {
  return {
    state: {
      connectedAt: this.connectedAt,        // JSON.stringify unwraps
      activeConnections: this.activeConnections,
    },
  }
}
```

`computed()` recomputes when stale on `toJSON` access — same cost as reading `.value`.

The `Ref<T>` and `ComputedRef<T>` interfaces gain a `toJSON(): T` method to match.

**`reactive()` is unchanged** — JSON.stringify walks its enumerable keys via the existing Proxy get-trap, already producing the correct shape. Test pins that behaviour as a regression guard.

**One-shot semantics**: `JSON.stringify` calls `toJSON` exactly once per value chain. `ref(ref(x))` serialises to `{"value": x}` rather than `x` because the inner ref's `toJSON` is reached via property walking, not a fresh substitution. The test suite documents this so a future "recursive unwrap" refactor doesn't land silently.

Backward-compatible — `toJSON` is additive, and existing code that read `.value` continues to work unchanged.
