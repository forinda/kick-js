---
'@forinda/kickjs-cli': patch
---

The client route map no longer turns deeply nested response types into `unknown`. Past `maxDepth` levels of inline nesting, the type at that point is hoisted to a declaration of its own and referenced by name, so every type stays exact and the emitted file stays shallow; recursive unions (`type Json = … | Json[]`) become recursive aliases. Only a type that never repeats — a generic yielding a new type at every level — is still emitted as `unknown`, and an abandoned route no longer leaves half-written declarations behind.
