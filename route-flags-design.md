# Route Flags — a shared vocabulary for "this endpoint is open"

> Status: **phases 1–3 implemented.** Phase 1: `defineRouteFlag`, `ctx.route`,
> contributor `skipWhen` / `onlyWhen`. Phase 2: `exemptWhen` on the ctx-style
> guards — `csrfGuard()` (new) and `rateLimitGuard()`. See
> `packages/kickjs/__tests__/route-flags.test.ts` and `route-flag-guards.test.ts`.
> Phase 3: the policy table, so the pre-match `rateLimit()` reads flags without
> giving up the traffic a guard cannot see. Phase 4 (OpenAPI + DevTools readers)
> ships alongside in its own PR.
> Decisions taken: core primitive in `@forinda/kickjs`; auth first, other consumers follow;
> declaration must sit on the controller and propagate to its routes.

## The recurring problem

Every cross-cutting concern that can be turned off per route invented its own way to say so.

| Concern           | How a route opts out today                           | Where it lives                             |
| ----------------- | ---------------------------------------------------- | ------------------------------------------ |
| Auth (BYO recipe) | `@Public` = `LoadAuthUser({ on401: 'allow' })`       | on the route, as a contributor             |
| CSRF              | `csrf({ ignorePaths: ['/api/v1/webhooks/stripe'] })` | in `bootstrap()`, as a string              |
| Rate limiting     | `rateLimit({ skipPaths, skip: (req) => … })`         | in `bootstrap()`, as a string or predicate |

One fact — _this endpoint is open_ — expressed three ways, in two places, with two different
notions of identity (decorator vs pathname string).

The path-string half has concrete defects, not just aesthetic ones:

- **Exact match only.** Both are a `Set.has(pathname)` (`csrf.ts:88`, `rate-limit.ts:137`), so
  `/api/v1/users/:id` cannot be expressed at all.
- **Drifts silently.** Change `apiPrefix`, bump a module's `version`, rename a path — the
  exemption list still parses, still runs, and now protects nothing. Nothing fails at boot.
- **Declared far from the thing it describes.** A reader of the controller cannot tell that the
  route is CSRF-exempt.

## What already works, and why it doesn't generalise

The contributor chain already delivers the declaration model we want. Spiked with four tests
against `packages/kickjs/src`, all passing:

| Case                                                                                    | Result              |
| --------------------------------------------------------------------------------------- | ------------------- |
| Global `contributors: [LoadAuthUser().registration]` protects an undecorated controller | 401                 |
| `@Public` on the **controller class** opens every method under it                       | 200 for all methods |
| Method-level `LoadAuthUser({ on401: 'throw' })` beats the class-level `@Public`         | 401                 |
| Authenticated request on a protected route resolves `ctx.get('user')`                   | 200                 |

So the five registration sites (`method > class > module > adapter > global`,
`contributor-pipeline.ts:20`) plus per-key dedup give controller-level declaration with
method-level override — for contributors.

**But look at how `@Public` actually wins.** It is not a way of saying "skip auth". It is a
_second instance of the same contributor_, registered at higher precedence, that happens to be
permissive:

```ts
const Public = LoadAuthUser({ on401: 'allow' }) // same key: 'user'
```

That only works because one author owns both sides — same `key`, same resolver, one behavioural
switch. It does not compose:

- A **third party's** contributor cannot be exempted. You do not own its key, so you cannot
  out-rank it with a permissive twin.
- A **non-contributor** consumer cannot be exempted at all — `csrf()` and `rateLimit()` have no
  key to override, which is exactly why they fell back to pathname strings.
- **Two concerns cannot share one decision.** "This endpoint is open" has to be re-stated for
  auth, for CSRF, and for rate limiting, because the statement is encoded in each concern's own
  mechanism rather than in the route.

The fact is about **the route**. Encoding it inside one consumer's mechanism is the mistake, and
it is why the problem keeps recurring.

## What doesn't work

1. **Pre-route middleware cannot participate.** `csrf()` and `rateLimit()` are mounted globally
   via `useConnect`, so they run before route matching and have no access to decorator metadata.
2. **No shared vocabulary.** A concern that wants to be exemptable has to invent an option shape.
   The next one will invent a fourth.
3. **Exemption is not composable.** See above — it requires owning the thing you are exempting.
4. **`RequestContext` exposes no matched route.** No `ctx.route` — nothing downstream can ask
   what handler it is on or what was declared there.

## Proposal

Flags are a **substrate**, not a fourth mechanism. One statement on the route; every consumer
reads it, including the contributor pipeline itself.

```text
                 @Public  /  @CsrfExempt  /  @RateLimit({ rpm: 10 })
                                   │
                            route flags          ← the fact, stated once on the route
                                   │
      ┌────────────────┬───────────┴───────────┬──────────────────┐
 contributors      middleware              guards            readers
 (skipWhen)      (exemptWhen)          (ctx.route.flags)   (swagger, devtools)
```

Contributors do not disappear — they become the most ergonomic consumer, and gain sugar they
cannot express today.

### 1. `defineRouteFlag()` — the primitive

A flag is a named, inheritable fact about a route. It carries no behaviour; consumers interpret it.

```ts
import { defineRouteFlag } from '@forinda/kickjs'

export const Public = defineRouteFlag('auth.public')
export const CsrfExempt = defineRouteFlag('csrf.exempt')
export const RateLimit = defineRouteFlag<{ rpm: number }>('rate.limit') // flags may carry a value
```

Applied at any of the same five sites as contributors, with the same precedence:

```ts
@Public // class level — propagates to every route below
@Controller()
class WebhooksController {
  @Get('/health') health(ctx: RequestContext) {} // inherits auth.public

  @Public(false) // method wins
  @Post('/admin')
  admin(ctx: RequestContext) {} // opts back in
}
```

Resolution reuses `contributor-pipeline.ts`'s ranked-source dedup verbatim — highest precedence
wins per flag name. No new ordering rules to learn or document.

#### A `false` flag is _absent_, not present-and-false

This rule is load-bearing, and getting it wrong is an authorization bypass rather than a
papercut. `@Public(false)` at method level must make the flag **unset** on that route, not set it
to `false` — otherwise `flags.has('auth.public')` returns `true` for the route that just opted
back **in**, and every presence-checking consumer reads a protected route as public.

So resolution produces a map of **enabled flags only**:

| Declaration                                            | Resolved                   |
| ------------------------------------------------------ | -------------------------- |
| `@Public` on the class, nothing on the method          | `auth.public → true`       |
| `@Public` on the class, `@Public(false)` on the method | _key absent_               |
| `@RateLimit({ rpm: 10 })`                              | `rate.limit → { rpm: 10 }` |
| `@RateLimit(false)` overriding an inherited one        | _key absent_               |

A flag therefore resolves to one of two states — absent, or present with a value that defaults to
`true`. `flags.has(name)` is then always the right question for a boolean flag, and
`flags.get(name)` for a valued one. There is no third "present but falsy" state to reason about,
and no consumer can be wrong by checking presence.

Two consequences worth stating:

- **`false` is only meaningful as an override.** `@Public(false)` on a route that never inherited
  `auth.public` is a no-op, and should probably warn at boot — it usually means the author
  believed something was inherited that is not.
- **The resolver, not the consumer, carries this.** Every alternative (a `ReadonlyMap<string,
unknown>` where consumers must remember `get(x) === true`) puts the security-relevant step in
  the hands of whoever writes the next guard. That is the failure mode this whole proposal
  exists to remove.

**Phase 1 acceptance test** (the case that fails if the rule regresses): class-level `@Public`
with a method-level `@Public(false)` — the method must resolve with `auth.public` absent, and a
request to it must be rejected by the auth contributor while its sibling routes stay open. Both
directions asserted, since a resolver that drops the key everywhere would pass a one-sided test.

### 2. `ctx.route` — the matched route, exposed

```ts
interface MatchedRoute {
  method: RouteMethod
  path: string // mounted path, e.g. '/api/v1/users/:id'
  controller?: Constructor
  handlerName?: string
  /** Enabled flags only — see "a `false` flag is absent" above. */
  flags: ReadonlyMap<string, unknown>
}
```

`RouteEntry.meta` already carries `controller` / `handlerName` at boot
(`http/runtime.ts:85-94`); this exposes it per request and adds the resolved flags. Useful well
beyond this proposal — logging, metrics, and DevTools all currently re-derive it.

### 3. Contributors consume flags — the sugar layer

A contributor registration gains `skipWhen` / `onlyWhen`, resolved against the route's flags
before the resolver runs:

```ts
const LoadAuthUser = defineHttpContextDecorator({
  key: 'user',
  skipWhen: 'auth.public', // ← the whole feature
  resolve: (ctx) => verify(ctx.headers.authorization),
})
```

This is the piece that makes exemption composable. Compare:

```ts
// today — only the key's owner can do this, and only by re-registering it
const Public = LoadAuthUser({ on401: 'allow' })

// with flags — anyone can exempt anything, without owning it
@Public
@Get('/health')
```

A plugin can now ship `LoadTenant` with `skipWhen: 'tenant.optional'`, and an adopter exempts a
route without forking the plugin or knowing its key. Same for `onlyWhen`, which covers the
inverse case that has no expression today at all — "run this contributor **only** on routes
flagged `billing.metered`" — currently a `dependsOn` chain or an `if` inside every resolver.

Contributor precedence is unchanged; `skipWhen` is evaluated per route after flag resolution, so
a class-level `@Public` skips the contributor for every route under it.

### 4. Middleware and guards read the same flags

```ts
csrf({ exemptWhen: 'csrf.exempt' })
rateLimit({ exemptWhen: 'auth.public' })
```

Guards and `@Middleware()` handlers read them directly, since they hold a `RequestContext`:

```ts
const requireAuth = (ctx: RequestContext, next: () => void) => {
  if (ctx.route.flags.has('auth.public')) return next()
  // …
}
```

Four consumers, one declaration. `ignorePaths` / `skipPaths` stay, deprecated, until a major.

## Reach: anything holding a `ctx` gets flags for free

This is what makes flags worth building rather than patching each consumer. The framework already
hands a `RequestContext` to almost everything that runs per request, and every one of those
becomes a flag consumer the moment `ctx.route.flags` exists — with no per-consumer API:

| Consumer                               |   Holds a `ctx`?   | How it reads flags                                        |
| -------------------------------------- | :----------------: | --------------------------------------------------------- |
| Controller handlers                    |         ✅         | `ctx.route.flags.has('auth.public')`                      |
| `@Middleware()` (method/class)         |         ✅         | same                                                      |
| Guards (`kick g guard`)                |         ✅         | same — they are `(ctx, next)` already                     |
| Context contributors                   |         ✅         | `skipWhen` / `onlyWhen`, or read `ctx.route` in `resolve` |
| Adapter middleware                     | ❌ raw `req`/`res` | needs the phase-2 mechanism                               |
| Global `middlewares` (csrf, rateLimit) |    ❌ pre-match    | needs the phase-2 mechanism                               |

So the surface splits cleanly: **everything after route matching is solved by exposing
`ctx.route`** — one addition, no per-consumer work, and it covers guards, per-route middleware,
contributors and handlers at once. Only the two pre-match cases need anything further, and they
are exactly the two that resorted to pathname strings.

That also means Phase 1 is worth shipping even if Phases 2–3 never happen.

## The one hard problem

Everything above holds a `ctx`, so it reads flags directly. The exception is pre-match
middleware: a flag lives on a route, and `csrf()` / `rateLimit()` run **before** a route is
matched, with raw `req`/`res` and no context. Two ways out, and this is the decision to make when
those consumers land — not now:

**(a) Mount exemptable middleware per route.** When a middleware declares `exemptWhen`, the
router builder attaches it to each route's chain instead of globally, with flags already
resolved. No matcher needed, exact semantics. Costs: the middleware no longer sees unmatched
requests (a 404 would skip rate limiting — arguably wrong for an abuse control), and it moves
after body parsing.

**(b) Compile a policy table at boot.** `method + mounted path → flags`, consulted by the global
middleware against the incoming request. Preserves today's ordering, but needs a path matcher —
a second implementation of routing that can disagree with the engine's.

Recommendation: **(a) for CSRF** (a token check is meaningless on an unmatched route) and **(b)
for rate limiting** (an abuse control must see traffic that matches nothing). They are different
problems wearing the same word.

**How phase 2 actually resolved this.** Neither, in the end — a third option the framework had
already invented for the edge. `rateLimitGuard()` was shipped as a **ctx-style** counterpart to
the connect-style `rateLimit()` so it could run on the web entry; a ctx-style middleware runs
_inside_ the matched route, which means it can read `ctx.route.flags` with no re-mounting and no
path matcher. Phase 2 therefore added `csrfGuard()` in the same shape and gave both an
`exemptWhen`.

The connect-style `csrf()` and `rateLimit()` keep their path lists and their pre-match position,
unchanged. That leaves a real choice rather than a migration: mount the connect middleware
app-wide when you want unmatched requests covered too, or the guard per controller when you want
flags. Option (b)'s policy table is still the answer for flag-aware limiting of traffic that
matches no route — deferred to phase 3, where it is the only remaining case.

## Phasing

**Phase 1 — primitive + `ctx.route` + contributor `skipWhen`.** `defineRouteFlag`, resolution
through the existing ranked-source pipeline, `ctx.route.flags`, and `skipWhen` / `onlyWhen` on
contributor registrations. That last part is what makes Phase 1 useful on its own: `@Public`
stops being "a permissive twin of the auth contributor" and becomes a fact any consumer can read.
No behaviour change to any existing app — every field is additive.

**Phase 2 — CSRF.** `exemptWhen`, per-route mounting, `ignorePaths` deprecated with a boot
warning naming the routes it currently covers.

**Phase 3 — rate limiting.** Policy table; `skipPaths` deprecated the same way. Also unlocks
per-route limits (`@RateLimit({ rpm: 10 })`), which the current shape cannot express at all.

**Phase 4 — readers.** OpenAPI security schemes from `auth.public`; `/_debug` route list shows
resolved flags per route.

Each phase ships alone and is useful alone.

## Risks

- **Re-baking an auth opinion.** `kickjs-auth` was deprecated for exactly that. Mitigation: the
  framework ships `defineRouteFlag` and _names no flags_. `auth.public` is a string the adopter
  (or a recipe) chooses; nothing in core branches on it.
- **A flag that lies.** A route flagged `auth.public` while no auth contributor is registered
  reads as "reviewed and intentionally open" when it is just unprotected. Consider a boot-time
  warning when a flag has no registered consumer.
- **Typo-silence.** `'auth.pubic'` should not be a valid flag. Mirror `ContextMeta`: a
  `KickRouteFlags` interface adopters augment, so unknown names are a tsc error once the first
  augmentation lands, and any string until then.

## Open questions

1. Do flags need values, or is presence enough? `@RateLimit({ rpm: 10 })` argues for values, and
   values make precedence a merge question rather than a pick-one.
2. Should `AppModule` gain a `flags()` site, or is module-level scoping better expressed by the
   existing adapter/global sites?
3. Is `ctx.route` worth shipping ahead of the rest? It stands on its own and unblocks logging
   and metrics work that has nothing to do with public routes.
4. Should `skipWhen` accept a predicate (`(flags, route) => boolean`) as well as a flag name?
   Cheap to add, and covers "skip unless both flags are present" without inventing an expression
   language. Risk: a predicate that reads anything other than flags reintroduces the coupling
   this design removes.
5. `@Public(false)` now has defined semantics (the flag resolves absent), but does it _read_
   clearly enough at the call site? A named inverse — `@Protected` — may be plainer than a
   boolean argument, at the cost of two decorators per flag. Semantics are settled either way.

## Why this is not just the contributor pipeline again

Worth stating plainly, because the two look similar: contributors carry **values** into a
request (`ctx.get('tenant')`) and run per request. Flags carry **facts about the route**, are
resolved at boot, and run nothing. Contributors are one consumer of flags; middleware, guards,
the OpenAPI generator and DevTools are others, and none of those can be expressed as a
contributor. The pipeline's ranked-source resolution is reused because the precedence question is
identical — that is shared machinery, not a shared concept.
