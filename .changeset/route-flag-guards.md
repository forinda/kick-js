---
'@forinda/kickjs': minor
---

`exemptWhen` on the ctx-style guards, and a new `csrfGuard()` (phase 2 of `route-flags-design.md`).

Route flags shipped in the previous minor could be read by anything holding a `RequestContext`, but the two middlewares that most need per-route exemption — CSRF and rate limiting — are mounted app-wide in their connect-style form and run before a route is matched. Their only handle on "not this endpoint" was an exact pathname string: `csrf({ ignorePaths })` / `rateLimit({ skipPaths })`, which cannot express `/webhooks/:provider` and keeps parsing after an `apiPrefix` or `version` change that silently voids it.

**`csrfGuard(options)`** is the ctx-style counterpart of `csrf()` — same double-submit cookie behaviour, but it runs inside the matched route, so it works on every runtime including `@forinda/kickjs/web`, and it can be exempted by flag:

```ts
const CsrfExempt = defineRouteFlag('csrf.exempt')

@Middleware(csrfGuard({ exemptWhen: 'csrf.exempt' }))
@Controller()
class WebhooksController {
  @CsrfExempt
  @Post('/:provider') // exempt, params and all
  receive(ctx: RequestContext) {}

  @Post('/settings') // still protected
  settings(ctx: RequestContext) {}
}
```

**`rateLimitGuard({ exemptWhen })`** does the same for limiting:

```ts
rateLimitGuard({ max: 60, exemptWhen: 'auth.public' })
rateLimitGuard({ max: 60, exemptWhen: ['auth.public', 'health.probe'] }) // any-of
rateLimitGuard({ max: 60, exemptWhen: ({ flags }) => flags.get('rate.limit')?.rpm === 0 })
```

Both accept a flag name, a list (matched any-of), or a predicate — the same `RouteFlagTest` the contributor `skipWhen` takes, now shared through one `matchesFlagTest()` so "which routes does this apply to" means the same thing everywhere.

The connect-style `csrf()` and `rateLimit()` are unchanged, path lists included. Mount those app-wide when you want requests matching no route covered too; reach for the guards when you want flags.
