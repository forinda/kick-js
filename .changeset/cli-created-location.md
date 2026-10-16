---
'@forinda/kickjs-cli': minor
---

The `create` handler `kick g module` and `kick g scaffold` generate answers 201 with a `Location` header pointing at the new record, built with `ctx.urlFor('<Name>Controller.getById', { id })` so it follows the module's mount path, API prefix and version. The generated controller test now really posts a record and asserts the 201 and the `Location` when the project has `@forinda/kickjs-testing` and `supertest`. Needs the matching `@forinda/kickjs` release for `reply.created(body, { location })`.
