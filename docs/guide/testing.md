---
description: How to test a KickJS application — setup, which kind of test for what, and guides to HTTP, unit, auth, background work, contributors, environment and large suites.
---

# Testing

KickJS apps are tested with [Vitest](https://vitest.dev). `@forinda/kickjs-testing` builds your app for a test without opening a port, sends requests through the runtime you deploy on, and replaces dependencies through DI. Database code has its own helpers in `@forinda/kickjs-db/testing`.

## What's in the box

| Package / helper                                                              | For                                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `createTestApp`, `client()`                                                   | building the app and sending requests — [HTTP Integration Tests](./testing/http.md)                                           |
| `useTestApp` (`@forinda/kickjs-testing/vitest`)                               | one app per file or per worker, set up and torn down for you                                                                  |
| `onTestReset`, `resetTestState`                                               | clearing fakes and caches between files — [Large Suites](./testing/large-suites.md)                                           |
| `runContributor`, `createTestPlugin`, `createTestModule`                      | contributors, plugins and hand-wired modules in isolation — [Contributors, Middleware and Plugins](./testing/contributors.md) |
| `withEnv` (`@forinda/kickjs`)                                                 | different config values for one test — [Test Environment](./testing/environment.md)                                           |
| `createTestDb`, `createPgTestDb`, `rolledBack` (`@forinda/kickjs-db/testing`) | a database per file, a rolled-back transaction per test — [Testing with kick/db](./database/testing.md)                       |
| `createTestClient` (`@forinda/kickjs-client`)                                 | typed, in-process requests to a `createWebApp` app — [Typed Client](./typed-client.md#network-free-testing)                   |

## Setup

An app made with `kick new` is ready to test: `pnpm test` runs Vitest (so does `kick test`, a command the scaffolded `kick.config.ts` defines). To add testing to an existing app:

<PmCommand add="@forinda/kickjs-testing vitest supertest @types/supertest unplugin-swc" dev />

Decorators need TypeScript's legacy decorator metadata, which esbuild and oxc don't emit, so tests compile through SWC. The scaffold's `vite.config.ts` already does this, and `vitest.config.ts` merges it rather than repeating it:

```ts
// vite.config.ts
import swc from 'unplugin-swc'
import { defineConfig } from 'vite'

export default defineConfig({
  oxc: false, // SWC compiles TypeScript instead
  plugins: [swc.vite()],
})
```

```ts
// vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'] },
  }),
)
```

`tsconfig.json` needs `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`. `reflect-metadata` is imported by `@forinda/kickjs` itself, so test files don't import it. Put test config in `.env.test` ([Test Environment](./testing/environment.md)).

::: tip Scaffold them
`kick g module <name>` writes a controller test (built with `createTestApp`) and a repository test next to the module. `kick g test <name>` writes an empty test file with `Container.reset()` already in `beforeEach`. Flags: [Generators](./generators.md#kick-g-test).
:::

Tests live next to the code they test, in `__tests__/` folders: `src/modules/users/__tests__/user.controller.test.ts`.

## Which test for what

| To check                                                          | Write                                          | Guide                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| a business rule: pricing, permissions, state changes              | a unit test of the service, with fakes         | [Unit Tests](./testing/units.md)                                  |
| an endpoint: routing, validation, status codes, the response body | an integration test through `client()`         | [HTTP Integration Tests](./testing/http.md)                       |
| who can call what                                                 | an integration test with tokens or a test user | [Testing Authentication](./testing/auth.md)                       |
| the queries a repository runs                                     | a test against a real database                 | [Testing with kick/db](./database/testing.md)                     |
| a job, a cron job, a socket handler, outgoing mail                | run the handler; record what leaves            | [Jobs, Cron, WebSockets and Mail](./testing/background.md)        |
| a contributor, a middleware, an adapter, a plugin                 | its helper, plus one integration test          | [Contributors, Middleware and Plugins](./testing/contributors.md) |

Most of a suite should be unit tests of the code that decides things, with integration tests proving each endpoint is wired up and enforces its rules. Keep end-to-end tests (a browser, the deployed stack) for a few critical journeys.

## A first test

```ts
// src/modules/users/__tests__/user.controller.test.ts
import { expect, it } from 'vitest'
import { useTestApp } from '@forinda/kickjs-testing/vitest'
import { UserModule } from '../user.module'

const t = useTestApp(() => ({ modules: [UserModule()] }), { client: { basePath: '/api/v1' } })

it('creates a user, then finds it', async () => {
  const created = await t.client().post('/users').send({ email: 'ada@x.io' }).expect(201)
  const found = await t.client().get(`/users/${created.body.id}`).expect(200)
  expect(found.body.email).toBe('ada@x.io')
})
```

That's the real `UserModule` (controller, service, repository) answering real HTTP on the default runtime. [HTTP Integration Tests](./testing/http.md) goes on from here.

## Guides

- [HTTP Integration Tests](./testing/http.md): `createTestApp`, the request client, `useTestApp`, overrides, testing the runtime you deploy, errors and uploads.
- [Unit Tests](./testing/units.md): services and use cases, the DI container, config values, time, fakes and mocks.
- [Testing Authentication](./testing/auth.md): signed tokens, logging in, a test strategy, roles, sessions and CSRF.
- [Jobs, Cron, WebSockets and Mail](./testing/background.md): work that happens outside a request.
- [Contributors, Middleware and Plugins](./testing/contributors.md): `runContributor`, middleware, adapters, `createTestPlugin`.
- [Test Environment](./testing/environment.md): `.env.test`, `withEnv`, `KICKJS_ENV_FILE`, `vi.stubEnv`.
- [Large Suites](./testing/large-suites.md): one app per worker, resets, database strategies, containers, independence.
- [Testing with kick/db](./database/testing.md): an in-memory database per file, a rolled-back transaction per test.

Feature guides with their own testing notes: [Asset Manager](./asset-manager.md#testing) (fixtures and the asset cache), [AI](./ai.md#testing) (a scripted provider), [MCP](./mcp.md#testing-with-mcp-inspector) (the MCP Inspector), [Context Decorators](./context-decorators.md#testing-contributors) (contributor recipes).
