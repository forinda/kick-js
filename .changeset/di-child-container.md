---
'@forinda/kickjs-di': minor
---

`container.createChild()` returns a container that resolves its own bindings first and falls back to its parent: overrides for one tenant, job or test without touching the parent.

- **Lookup:** `has()` looks through to the parent; the new `hasOwn()` doesn't. Lookup order is the child's binding, the parent's, the child's fallback, then the parent's.
- **REQUEST scope:** a child's REQUEST-scoped instances are kept apart from the parent's in the same request.
- **HMR:** an invalidation in the parent rebuilds what the child built on it.
- **Lifetime:** `dispose()` detaches a child. Children are held weakly, so one that is never disposed is still garbage-collected.
