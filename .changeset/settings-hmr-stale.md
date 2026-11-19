---
'@forinda/kickjs-di': minor
'@forinda/kickjs': patch
---

Settings sections no longer keep an old value across a dev reload. A section bound once was carried into every later `Container.reset()`, so after a save that made it `.optional()` or stopped declaring it, `get()` and injection kept returning the value read at the first start, whatever `.env` said. Bound sections are now forgotten on reset and read afresh; a failed `rebuild()` still serves the running app's values through `get()`.

`Container.registerInstance()` takes `{ persist: false }` for a value that must not survive `Container.reset()`.

`Container.invalidate()` leaves a binding made with `registerInstance()` in place: there is nothing to build it again from, and on an isolated container (or with `{ persist: false }`) it used to clear the value, so the next `resolve()` built an empty object from its constructor.
