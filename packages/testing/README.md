# @forinda/kickjs-testing

Test utilities for KickJS — `createTestApp` and `createTestModule` helpers.

## Install

```bash
pnpm add -D @forinda/kickjs-testing
```

## Features

- `createTestApp()` — creates an Application instance for testing (resets container, empty middleware)
- `createTestModule()` — builds a dynamic test module with custom DI registrations
- DI overrides for mocking repositories and services (supports symbol keys)

## Quick Example

```typescript
import { createTestApp } from '@forinda/kickjs-testing'
import { describe, it, expect } from 'vitest'
import supertest from 'supertest'

describe('UserController', () => {
  it('lists users', async () => {
    const { expressApp } = createTestApp({
      modules: [UserModule],
      overrides: {
        [USER_REPO]: new MockUserRepository(),
      },
    })

    const res = await supertest(expressApp).get('/api/v1/users')
    expect(res.status).toBe(200)
  })
})
```

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
