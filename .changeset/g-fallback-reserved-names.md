---
'@forinda/kickjs-cli': patch
---

`kick g <generator> <name>` no longer silently scaffolds modules when the generator name fails to route. The bare `kick g <names...>` form is module shorthand and previously sent ANY unmatched first token straight to module generation — so on a CLI older than a given generator (e.g. `contributor`), `kick g contributor tenant` quietly created modules named `contributor` and `tenant` instead of erroring. The fallback now refuses a reserved generator name with a clear message (and an "upgrade your CLI" hint) instead of scaffolding modules. Plain module shorthand (`kick g user task`) is unaffected.
