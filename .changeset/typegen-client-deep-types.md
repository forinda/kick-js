---
'@forinda/kickjs-cli': patch
---

The client route map no longer cuts deeply nested response types off at `maxDepth`. Past that many levels of inline nesting, the type at that point is hoisted to a declaration of its own and referenced by name, so the types stay exact and the emitted file stays shallow; recursive unions (`type Json = … | Json[]`) become recursive aliases. Hoists spend a per-route budget of 1,000: a route that exhausts it — a generic that yields a new type at every level, or a response nesting more distinct types than that — is still emitted as `unknown` with a warning, and no longer leaves half-written declarations behind.
