# Route Flags

A route flag is a named, inheritable fact about a route. It carries no behaviour of its own — it records something any consumer can read: this endpoint is public, this one is exempt from CSRF, this one is unmetered.

```ts
import { defineRouteFlag } from '@forinda/kickjs'

export const Public = defineRouteFlag('auth.public')
```

```ts
@Public // on the controller — every route below inherits it
@Controller()
export class WebhooksController {
  @Get('/health')
  health(ctx: RequestContext) {} // public

  @Public(false) // the method wins
  @Post('/admin')
  admin(ctx: RequestContext) {} // not public
}
```

## Why not just a decorator per concern?

Because the same fact keeps getting restated. Before flags, "this endpoint is open" was said three different ways: auth used a contributor, CSRF used `ignorePaths`, rate limiting used `skipPaths`. Two of those are exact pathname strings that cannot express `/users/:id` and keep parsing after an `apiPrefix` change that voids them.

A flag is declared once, on the route, and every consumer reads the same thing.

## Reading flags

Anything holding a `RequestContext` — handlers, `@Middleware()`, guards, contributors — gets them from `ctx.route`:

```ts
const requireAuth = (ctx: RequestContext, next: () => void) => {
  if (ctx.route?.flags.has('auth.public')) return next()
  if (!ctx.headers.authorization) throw new HttpException(401, 'Unauthorized')
  next()
}
```

`ctx.route` also carries `method`, `path`, `controller` and `handlerName`. It is `undefined` in global middleware, which runs before a route is matched.

## Flags with values

A flag can carry more than presence:

```ts
const RateLimit = defineRouteFlag<{ rpm: number }>('rate.limit')

@RateLimit({ rpm: 10 })
@Post('/login')
login(ctx: RequestContext) {}
```

```ts
ctx.route?.flags.get('rate.limit') // { rpm: 10 }
```

## A `false` flag is absent, not false

::: warning This is the rule that makes `has()` safe
`@Public(false)` **removes** the flag its class set — it does not store `false`. So a resolved flag is either absent or present with a value defaulting to `true`, and there is no present-but-falsy state.

Without that rule, `flags.has('auth.public')` would answer `true` for the route that just opted back _in_, and every presence-checking consumer would read a protected route as public.
:::

| Declaration                                    | Resolved                   |
| ---------------------------------------------- | -------------------------- |
| `@Public` on the class, nothing on the method  | `auth.public → true`       |
| `@Public` on the class, `@Public(false)` on it | _absent_                   |
| `@RateLimit({ rpm: 10 })`                      | `rate.limit → { rpm: 10 }` |

`@Public(false)` on a route that never inherited the flag is a no-op — usually a sign the author expected an inheritance that isn't there.

## Consumers

### Context contributors

`skipWhen` / `onlyWhen` on a contributor registration:

```ts
const LoadAuthUser = defineHttpContextDecorator({
  key: 'user',
  skipWhen: 'auth.public',
  resolve: (ctx) => verify(ctx.headers.authorization),
})
```

This is what makes exemption composable. Without it, the only way to opt out of a contributor is to register a permissive twin under the same key — which requires owning that key, so you cannot exempt a contributor a plugin shipped. A flag lives on the route, so you can.

`onlyWhen` is the inverse: run **only** where the flag is present.

### Guards and middleware

`csrfGuard()` and `rateLimitGuard()` take `exemptWhen`:

```ts
@Middleware(csrfGuard({ exemptWhen: 'csrf.exempt' }))
@Middleware(rateLimitGuard({ max: 60, exemptWhen: 'auth.public' }))
@Controller()
export class ApiController {}
```

Both are ctx-style, so they run inside the matched route. The connect-style `csrf()` and `rateLimit()` run _before_ route matching — they cover requests that match no route, but they cannot read flags. That is a real choice, not a migration.

## Matching: name, list, or predicate

Every `skipWhen` / `onlyWhen` / `exemptWhen` accepts the same three forms:

```ts
'auth.public' // this flag
;['auth.public', 'health.probe'] // any of these
;({ flags, route }) => flags.has('a') && flags.has('b') // anything else
```

A list is **any-of** — it reads as "these are all reasons to skip". All-of, value checks and path checks go through a predicate:

```ts
exemptWhen: ({ flags }) => (flags.get('rate.limit') as Limit | undefined)?.rpm === 0
exemptWhen: ({ route }) => route?.path.startsWith('/internal') ?? false
```

Keep predicates cheap — they run per request, per consumer.

## Where flags can be declared

Method and class today, resolved method-over-class. Module, adapter and global registration sites are planned, matching the [context contributor](./context-decorators.md) precedence chain.

## Naming

The framework ships `defineRouteFlag` and names no flags. `auth.public` is a string you choose — nothing in the core branches on it, which is deliberate: a framework-blessed `@Public` would bake in an auth opinion, and that is what got the old auth package deprecated in favour of [BYO recipes](./byo-recipes.md).

Pick a namespace per concern (`auth.*`, `csrf.*`, `billing.*`) so a reader can tell who consumes a flag.
