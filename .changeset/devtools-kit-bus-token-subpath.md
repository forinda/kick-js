---
'@forinda/kickjs-devtools-kit': minor
---

Add `@forinda/kickjs-devtools-kit/bus/token` subpath that exports `DEVTOOLS_BUS` separately from the bus runtime. Browser SPAs and other framework-free consumers can now import from `/bus` without pulling `createToken` (and through it the entire `@forinda/kickjs` runtime) into their bundle. Server-side adapters and plugins that need the DI token import it from `/bus/token`.

The README now documents every subpath (`.`, `/runtime`, `/types`, `/bus`, `/bus/token`) with whether each one pulls in the framework, and the lockstep-versioning claim has been replaced with the Changesets-based flow.
