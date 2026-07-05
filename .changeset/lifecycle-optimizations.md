---
'@forinda/kickjs': minor
---

perf + lifecycle: object-lifecycle audit fixes across the framework layer

**Hot-path allocations removed**

- Fastify/h3 runtimes: validation middleware is now built once per route
  (previously re-constructed on every request) and the response driver is a
  shared-prototype class (previously ~12 method closures allocated per request)
- DI container: instantiation plans are precomputed per registration — REQUEST-
  and TRANSIENT-scoped resolves no longer re-read Reflect metadata (5 reads +
  2 throwaway Maps per instantiation)
- `tokenName()` is no longer computed on the cached-singleton resolve path when
  no container change listener is attached
- `ctx.problem` is memoized per context (was ~10 closures per access)
- `@Autowired` singleton dependencies memoize into a data property on first
  read; REQUEST/TRANSIENT deps keep the live getter

**Leaks fixed**

- Reactivity: `watch().stop()` now detaches the effect from all dependency
  Sets (previously dead watchers accumulated and kept firing); effects re-track
  per run so conditional getters drop stale branches; `computed()` gains
  `dispose()`; `reactive()` memoizes nested proxies (stable identity)
- `MemoryCacheProvider` is bounded (LRU, default 10 000 entries)
- In-memory session/rate-limit store cleanup intervals are now disposed by
  `Application.shutdown()` via a new disposables registry
  (`registerDisposable`/`disposeAll`)
- Container change-batch debounce timer is `unref()`'d and flushed on shutdown

**New: `@PreDestroy`**

Counterpart to `@PostConstruct`. On REQUEST-scoped services the hook runs when
the response closes (finished or aborted) on all three runtimes — release
per-request transactions/handles/subscriptions there.

`@Cacheable` now caches legitimate `null` results (previously indistinguishable
from a cache miss, so null-returning methods re-executed on every call).
