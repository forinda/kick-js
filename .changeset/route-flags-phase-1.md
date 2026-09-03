---
'@forinda/kickjs': minor
---

Route flags — one vocabulary for per-route policy (phase 1 of `route-flags-design.md`).

`defineRouteFlag()` declares a named, inheritable fact about a route. Declare it on a controller and it applies to every route below; a method overrides its class:

```ts
export const Public = defineRouteFlag('auth.public')

@Public
@Controller()
class WebhooksController {
  @Get('/health') health(ctx: RequestContext) {} // inherits auth.public

  @Public(false) // method wins
  @Post('/admin')
  admin(ctx: RequestContext) {} // flag is ABSENT here
}
```

A flag resolves to **absent**, or **present with a value defaulting to `true`** — never present-and-false. That is what makes `flags.has(name)` safe to write in a guard: `@Public(false)` removes the flag the class set rather than storing `false`, so a presence check can't read a re-protected route as public.

**`ctx.route`** exposes the matched route — `method`, `path`, `controller`, `handlerName`, and the resolved `flags` — to anything holding a `RequestContext`: handlers, `@Middleware()`, guards, contributors. Works identically on Express, Fastify, h3, and the `@forinda/kickjs/web` fetch entry.

```ts
const requireAuth = (ctx: RequestContext, next: () => void) => {
  if (ctx.route?.flags.has('auth.public')) return next()
  // …
}
```

**Contributors gain `skipWhen` / `onlyWhen`**, which is what makes exemption composable. Previously a contributor could only be opted out of by registering a permissive twin under the same key — something only its author can do. A flag lives on the route, so an adopter can exempt a plugin's contributor without owning its key:

```ts
defineHttpContextDecorator({ key: 'user', skipWhen: 'auth.public', resolve })
defineHttpContextDecorator({ key: 'usage', onlyWhen: 'billing.metered', resolve })
```

Both accept a flag name, a list of names (matched **any-of**), or a predicate `({ flags, route }) => boolean` for anything else — all-of, a flag's value, a path check.

Additive: no existing API changes behaviour, and a route with no flags resolves an empty map.
