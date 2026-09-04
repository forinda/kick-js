---
'@forinda/kickjs': patch
---

Export `BareRouteFlag` and `ValuedRouteFlag` so a consumer can export a flag (#641).

`RouteFlag<V>` is a conditional over those two interfaces, and only the alias was exported. A consumer writing the documented shape:

```ts
export const Public = defineRouteFlag('auth.public')
```

failed to emit declarations:

```
error TS4023: Exported variable 'Public' has or is using name 'BareRouteFlag'
from external module ".../dist/route-flag-GzEeUmws" but cannot be named.
```

Flags are meant to be shared across controllers, so `export const` in a small module is the natural usage — and there was no non-exported way to use one across files. Both interfaces are now re-exported from the entry; the `RouteFlag` annotation workaround is no longer needed.
