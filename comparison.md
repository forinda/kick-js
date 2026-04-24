# KickJS v4 — How It Stacks Up

An honest comparison of KickJS against the other Node.js / TypeScript backend frameworks adopters typically evaluate alongside it. Written from the framework author's chair — biased toward KickJS by definition, but specific about where it doesn't win and why.

> **Snapshot** — generated against KickJS v4.1.x. Re-evaluate after the v4.1.2 cutover when the deprecated wrappers go private and the BYO recipes become the canonical extension surface.

## Versus the field

| Dimension | NestJS | Fastify | Hono | AdonisJS | **KickJS v4** |
|---|---|---|---|---|---|
| **Decorators + DI** | Heavy, class-based, opinionated | None natively | None | Heavy, IoC-via-classes | Factory-first (`defineAdapter` / `definePlugin`), decorators only where they earn it |
| **Type safety end-to-end** | Good for DI tokens, weak for routes/ctx | Schema → types via plugins | TS-native, route inference | Manual via TS contracts | **Strong**: typegen narrows `ctx.params/body/query`, `ContextMeta` keys, `dependsOn`, `deps`, asset paths — all from source scan, no class registry |
| **Extensibility primitives** | Modules, providers, dynamic modules, custom decorators | `fastify-plugin` encapsulation + hook system | Middleware + helpers | Service providers + IoC bindings | `defineAdapter` / `definePlugin` / `defineContextDecorator` / `defineAugmentation` / `introspect()` / `devtoolsTabs()` — narrow surfaces, all composable |
| **Per-request typed context** | `@Inject(REQUEST)` (request-scoped DI) | `request.diScope` (via plugins) | `c.var` (untyped without manual decl) | Container `request.ioc` | `ctx.set/get` typed via `ContextMeta` augmentation + ALS-backed Map shared across middleware/contributor/handler instances |
| **HMR in dev** | None native; nodemon | None native | tsx/Bun watch | None native | **Single-port Vite HMR** via `@forinda/kickjs-vite` — keeps DB connections + typed routes hot |
| **Plugin-author ergonomics** | Module + Provider + dynamic config — verbose | `fastify-plugin` ergonomic but untyped extensions | Plain middleware | Service providers | `defineAdapter()` factory + `contributors?()` hook + `introspect()` slot — adapter authors ship one factory and adopters get DI + lifecycle + DevTools |
| **Lock-in** | High (class hierarchies, module decorators, private state) | Low | Low | High | **Low** — we just dropped 5 packages and replaced with 100-LOC BYO recipes that adopters can fork |
| **Bundle / cold start** | Heavy (~50KB gzipped + reflect-metadata + RxJS pull-in for some packages) | Tiny | Tiny | Heavy | Medium — Express 5 + reflect-metadata + DI; no RxJS, no peer-dep avalanche |
| **Ecosystem size** | Massive | Big | Growing fast | Solid | **Tiny — by design, getting smaller** (5 wrappers being deprecated; BYO is the explicit answer) |
| **Community / docs maturity** | Very mature | Mature | Mature | Mature | New — most docs were written this month |

## Where KickJS clearly wins

### 1. Typed context contributors as a first-class primitive

Nothing in Nest / Fastify / Hono / Adonis gives you a single typed mechanism for: "compute X once per request, type-safe via augmentation, topo-sorted via `dependsOn`, mockable in unit tests, runnable across HTTP / WS / queue / cron." Nest comes closest with request-scoped providers but loses the `dependsOn` ordering and the ALS-shared-bag write surface.

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta { tenant: { id: string; plan: 'free' | 'pro' } }
}

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx) => repo.find(ctx.req.headers['x-tenant'] as string),
})

@LoadTenant
@Get('/me')
me(ctx: RequestContext) {
  ctx.get('tenant')   // typed { id; plan }
}
```

### 2. Generator + typegen feedback loop

Most frameworks rely on hand-typed route registries. KickJS scans source for `@Get`, `createToken`, `defineAdapter`, `defineAugmentation`, asset files, env keys — and emits `KickRoutes`, `KickJsPluginRegistry`, `KickAssets`, `KickEnv` augmentations that narrow IDE completion *as you save*. After v4.1.x typing tightening (`ContextMetaKey` on `dependsOn`, `DepValue` on `deps`), most "did I spell that right" mistakes fail at compile time instead of at boot.

### 3. Subtractive evolution

This session deprecated 5 packages in favour of BYO recipes that reuse the framework's own primitives. Frameworks that grow only-additively (adds, never removes) accumulate API debt; frameworks that shrink toward a stable core tend to age better. The factory-first surface (`defineAdapter` / `definePlugin`) makes the BYO substitutions a 100-LOC swap, not a rewrite.

### 4. Single-port dev with real HMR

Nest / Adonis restart the whole process on save; Fastify / Hono need separate watcher tooling. KickJS + Vite swaps modules in place while keeping DB connections, WebSockets, and the HTTP server warm.

## Where KickJS clearly loses (today)

### 1. Ecosystem volume

Nest has ~300 mainstream community packages. KickJS has ~15 first-party + your BYO. If you need "GraphQL with Apollo Federation v2 + DataLoader + GraphQL Shield + Mercurius cache hints" out of the box, Nest is your faster path.

### 2. Track record

Nest has been at scale at thousands of companies for ~6 years. Fastify even longer. KickJS is new — battle-testing is just starting. There is no "10 hours of conference talks on production patterns" to lean on yet.

### 3. Hiring

"We use NestJS" filters CVs; "we use KickJS" doesn't.

### 4. Stack Overflow + LLM training data

Ask Claude / GPT-4 "how do I X in NestJS" and get a confident answer drawn from thousands of examples. Same question for KickJS hits a much shallower well — partially mitigated by the `AGENTS.md` / `CLAUDE.md` / `kickjs-skills.md` trio shipped in every project, but the asymmetry is real.

## Adaptability: rated

| Property | Score | Why |
|---|---|---|
| **Cleanliness of core surface** | **9 / 10** | Three factories (`defineAdapter`, `definePlugin`, `defineContextDecorator`) cover most extension; everything else is helpers. Few frameworks are this small at the core. |
| **Extensibility** | **8 / 10** | Adapters / plugins / contributors compose cleanly; DevTools `introspect()` keeps custom adapters discoverable. The BYO pattern is the proof — 100 LOC replaces a shipped wrapper. −1 for the deprecation churn that hasn't fully landed. |
| **Type safety** | **9 / 10** | Better than every peer except maybe ElysiaJS for route-only typing. Ahead of all of them on `dependsOn` / `deps` / `ContextMeta` / asset key narrowing. |
| **Adaptability — swap pieces** | **9 / 10** | The BYO migrations land this session are evidence — the framework's own pieces are replaceable by adopter recipes without forking. −1 for the docs-still-converging point. |
| **Maturity / ecosystem** | **4 / 10** | Honest. Catching up requires either time or a flagship adopter case study. |
| **Production-readiness** | **7 / 10** | Tests + lint + typegen + HMR + DevTools are all real. The unknowns are soak time at scale. |
| **Documentation** | **7 / 10** | Substantially better after the BYO + audit work, but still has rough edges; most live docs were rewritten <30 days ago. |

## Strategic positioning

| If you value… | Pick… |
|---|---|
| Architectural cleanliness, type-safety depth, the option to swap any piece without forking | **KickJS v4** — best-in-class, locked in by v4.1.2 |
| Ecosystem volume, hireability, battle-tested defaults right now | **Nest** — safer bet today; you give up cleanliness for community |
| Edge / Cloudflare Workers / Bun-first deployment | **Hono** or **Elysia** — they own that frontier |
| Full-stack opinionated stack (auth, ORM, templating, mailer all integrated) | **AdonisJS** |
| Bare-metal performance with no opinions | **Fastify** |

## The asymmetric edge

The one thing KickJS does that none of the others do: the **`AGENTS.md` / `kickjs-skills.md` / `CLAUDE.md` trio** scaffolded into every generated project, regenerated from upstream templates via `kick g agents`. That's a real productivity edge for AI-assisted development that the older frameworks haven't caught up to. As LLM-driven coding becomes the default, that asymmetry compounds — every contributor (human or agent) starts from the same canonical guide, and the guide stays current with the framework via a single CLI command.

## TL;DR

KickJS v4 is **the framework that takes type-safety and AI-assisted development seriously, in exchange for being smaller and newer.** Not for everyone today; well-positioned for where the field is going.

The honest call:

- **Pick it now** if you're starting a project where type safety, HMR, and clean extensibility matter more than ecosystem volume — and you're willing to absorb the ecosystem-maturity gap by writing the occasional BYO recipe.
- **Wait for v4.2** if you want the deprecation churn behind you and a stable surface to commit to. The v4.1.2 cutover is the inflection point; v4.2 should be the "stable" stamp.
- **Pick Nest** if you need to hire fast, integrate with a long tail of community packages, or convince a sceptical CTO with track record alone.

The asymmetry that matters is the trajectory: KickJS is **shrinking toward a stable core**; the older frameworks are **growing API debt**. Where each lands in two years is the bet.
