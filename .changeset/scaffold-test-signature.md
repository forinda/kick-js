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

The generated `vitest.config.ts` also lost the `@` path alias that
`tsconfig.json` and `vite.config.ts` declare. A `vitest.config.ts` overrides
`vite.config.ts` outright — vitest merges nothing and never reads tsconfig
`paths` — so any `@/…` import type-checked, built, and ran in dev while
failing only under test with `Cannot find package '@/…'`.

It now merges the vite config via `mergeConfig` rather than restating it, so
the alias, plugins, and ssr externals have exactly one definition instead of
three that can drift apart.

Loading the vite config through vitest also surfaced `__dirname`, which does
not exist under Vite's `configLoader: 'native'` — slated to become the default
— and warned on every test run. The generated vite config now derives its
paths from `import.meta.url`, which needs no Node version floor.

The generated test templates also never imported the env side-effect module.
`createTestApp` does not load `src/index.ts`, so the `import './config'` that
registers the extended env schema never ran under test: `ConfigService.get()`
returned `undefined` while `@Value()` kept working through its `process.env`
fallback, so the two disagreed only in tests. The templates now import
`@/config`, and the env-wiring skill gained a test-specific diagnosis step —
its existing step 1 checks `src/index.ts`, which looks correct in exactly this
case.

That skill also showed `loadEnv(envSchema)` with `defineEnv` while the scaffold
generates `loadEnvFromSchema` with `fromZod`, so anyone following it saw code
that did not match their project. Both forms are valid; the skill now shows the
generated one.
