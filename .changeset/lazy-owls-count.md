---
'@forinda/kickjs': patch
---

Warn when `@PreDestroy` is applied to a service it will never run on.

`@PreDestroy` fires when a REQUEST scope closes. On a SINGLETON — the default
scope — nothing closes, so the hook is inert. It was silently inert: no type
error, no log, no startup check. The reported case was a Postgres pool never
closed on shutdown, invisible in development and surfacing as connection
exhaustion under repeated restarts and HMR reloads.

The asymmetry is what makes it a trap. `@PostConstruct` DOES run for singletons,
so the pair reads as init/teardown while one half quietly opts out based on a
scope the author may never have considered.

Applying `@PreDestroy` to a non-REQUEST service now logs once, naming the class,
its scope, and the seam that does work:

```text
kickjs: @PreDestroy on DatabaseService (singleton) will never run — that hook
fires only when a REQUEST scope closes.
For application-lifetime resources, release them from an adapter's shutdown()
hook instead.
```

The decorator's own documentation now says the same, since it previously
described only the REQUEST case and left the singleton behaviour to be inferred.

Deliberately a warning rather than running the hook on shutdown: making it fire
is a behaviour change whose ordering, timeout and concurrency semantics have to
match the adapter shutdown path, and an adapter's `shutdown()` already covers
application-lifetime resources — the framework runs it on a real shutdown and on
every HMR reload, time-boxed and concurrent.
