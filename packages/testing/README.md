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
    const { expressApp } = await createTestApp({
      modules: [UserModule],
      overrides: { [USER_REPO]: new MockUserRepository() },
    })

    const res = await supertest(expressApp).get('/api/v1/users')
    expect(res.status).toBe(200)
  })
})
```

## Documentation

[forinda.github.io/kick-js/guide/testing](https://forinda.github.io/kick-js/guide/testing)

## License

MIT
