# @forinda/kickjs-testing

Test helpers for KickJS: `createTestApp` boots your real modules with a request client, no port needed. Also `createTestModule`, `runContributor` and `createTestPlugin` for testing pieces in isolation.

## Install

```bash
pnpm add -D @forinda/kickjs-testing supertest
```

## Quick example

```ts
import { describe, expect, it } from 'vitest'
import { createTestApp } from '@forinda/kickjs-testing'
import { UserModule, USER_REPO } from '../src/modules/users'

describe('users', () => {
  it('lists users', async () => {
    const { client } = await createTestApp({
      modules: [UserModule()],
      overrides: [[USER_REPO, new InMemoryUserRepository()]],
    })

    const res = await client().get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(1)
  })
})
```

Pass `runtime` (as you do to `bootstrap()`) to test on the engine you deploy.

## Documentation

[kickjs.app/guide/testing](https://kickjs.app/guide/testing): HTTP tests, auth, jobs and sockets, contributors, environment, large suites.

## License

MIT
