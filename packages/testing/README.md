# @forinda/kickjs-testing

Test utilities for KickJS — `createTestApp`, `createTestModule`, `runContributor` (single contributor in isolation), and `createTestPlugin` (plugin harness with isolated container + lifecycle invokers).

## Install

```bash
pnpm add -D @forinda/kickjs-testing
```

## Quick Example

```ts
import { describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { createTestApp } from '@forinda/kickjs-testing'
import { UserModule, USER_REPO } from './modules/users'
import { MockUserRepository } from './mocks'

describe('UserController', () => {
  it('lists users', async () => {
    const { app } = await createTestApp({
      modules: [UserModule()],
      overrides: [[USER_REPO, new MockUserRepository()]],
    })

    const res = await supertest(app.handle.bind(app)).get('/api/v1/users')
    expect(res.status).toBe(200)
  })
})
```

Drive `app.handle` — it is the Application's own request listener and follows
whichever runtime is configured. (`expressApp` is deprecated and throws under
Fastify or h3.)

## Test the engine you deploy

Pass `runtime`, the same value you give `bootstrap()`. Routing, body parsing,
status handling and error mapping all live in the runtime seam, so a green
Express suite says nothing about them if you ship Fastify:

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

const { app } = await createTestApp({
  modules: [UserModule()],
  runtime: fastifyRuntime(),
})
```

`overrides` takes entries or a `Map` as well as an object — a `createToken()`
token is a frozen object, which TypeScript rejects as a computed key.

## Documentation

[kickjs.app/guide/testing](https://kickjs.app/guide/testing)

## License

MIT
