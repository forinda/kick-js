---
'@forinda/kickjs-swagger': patch
---

Fix public routes still requiring auth in the spec when `bearerAuth: true` is set.

`bearerAuth: true` installs a security requirement at the **root** of the
OpenAPI document, and OpenAPI applies a root requirement to every operation
that does not override it. `@ApiPublic`, a `securityResolver` returning `null`,
and `publicFlag` all emitted no `security` key on the operation — which means
"inherit the root requirement", so the spec documented those routes as needing
a bearer token anyway.

They now emit `security: []`, the only spelling OpenAPI has for an open
operation. Specs built without a global requirement are unchanged: an empty
array there would be noise, so `security` stays unset.
