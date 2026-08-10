---
'@forinda/kickjs-cli': patch
---

Fix the `createTestApp` signature in every generated doc and skill, and install
the packages those docs depend on.

The scaffolded AGENTS.md and the `write-controller-test` skill showed
`createTestApp([UserModule])` followed by `app.get('/…')`. Neither is real:
the function takes an options object, and the result is
`{ app, expressApp, container }` with no `.get()`. Following the generated
instructions threw `this.options.modules is not iterable`, so every scaffolded
controller test failed before asserting anything — including tests written by
coding agents, which read these files as their source of truth.

`defineAugmentation`'s catalogue example passed an object literal for
`example`, which is typed `string` — a type error in the generated docs.

The scaffold also told readers to import `@forinda/kickjs-testing` and
`supertest` without installing either. Both are now in `devDependencies`
alongside `@types/supertest`.

A test in `@forinda/kickjs-testing` now pins the documented call shape, so the
docs and the API cannot drift apart again silently.

The generated `vitest.config.ts` also lacked the `@` path alias that
`vite.config.ts` and `tsconfig.json` both declare. Vitest does not read
tsconfig `paths`, so an `@/…` import type-checked and built but failed only
under test with `Cannot find package '@/…'` — including the
`@/generated/prisma/client` imports `kick g module --repo prisma` emits on
Prisma 7. All three now agree, with a test pinning the parity.
