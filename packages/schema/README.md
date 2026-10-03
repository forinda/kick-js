# @forinda/kickjs-schema

One validation interface for KickJS. Route validation, env loading, OpenAPI and `kick typegen` accept Zod, Valibot, Yup or any Standard Schema validator, so you pick the library.

## Install

```bash
pnpm add @forinda/kickjs-schema zod   # or valibot, or yup
```

`kick new` installs it for you.

## Quick example

Pass your library's schema straight to a route; it's detected and wrapped:

```ts
import { Controller, Post } from '@forinda/kickjs'
import * as v from 'valibot'

@Controller()
export class UserController {
  @Post('/', { body: v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) }) })
  create(ctx) {
    // ctx.body is validated and typed
  }
}
```

Each library has its own subpath (`/zod`, `/valibot`, `/yup`), and `registerAdapter()` adds one that isn't built in.

## Documentation

- [Schema-agnostic validation](https://kickjs.app/guide/schema): adapters, `detectSchema()`, writing your own
- [Validation](https://kickjs.app/guide/validation), [Configuration](https://kickjs.app/guide/configuration), [Type Generation](https://kickjs.app/guide/typegen)

## License

MIT
