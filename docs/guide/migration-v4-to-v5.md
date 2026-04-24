# Migrating to v5

v5 is a pure removal release. Six wrapper packages that shipped deprecation notices in v4.2.x are gone in v5; everything else is source-compatible.

If your app never touched those wrappers — `pnpm up @forinda/kickjs@^5` and ship. The vast majority of v4 projects fall here.

If you do use one of the dropped wrappers, each has a BYO recipe under [`docs/guide/`](./index.md) that wires the upstream library directly through `defineAdapter` / `definePlugin`. The recipes were published in v4.2.0 with four months' lead time so the swap is copy-paste, not rewrite.

## What's removed

| v4 package                      | v5 status   | Replacement                                                                   |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `@forinda/kickjs-graphql`       | **removed** | [GraphQL BYO recipe](./graphql.md) — graphql-http / Yoga / Apollo             |
| `@forinda/kickjs-otel`          | **removed** | [OpenTelemetry BYO recipe](./otel.md) — `@opentelemetry/sdk-node`             |
| `@forinda/kickjs-cron`          | **removed** | [Scheduled tasks BYO recipe](./cron.md) — `croner` / `node-cron`              |
| `@forinda/kickjs-mailer`        | **removed** | [Mailers BYO recipe](./mailer.md) — `nodemailer` / Resend / SES               |
| `@forinda/kickjs-multi-tenant`  | **removed** | [Multi-tenancy BYO recipe](./multi-tenancy.md) — `defineHttpContextDecorator` |
| `@forinda/kickjs-notifications` | **removed** | [Notifications BYO recipe](./notifications.md) — your channel backend         |

The last published v4.2.x release of each package carries an `npm deprecate` warning linking to its BYO guide. They continue to install if you pin to `@<5`, but new installs and CI matrices should migrate.

## What's unchanged

Everything else in the ecosystem:

- `@forinda/kickjs` (core + HTTP) — same API surface, same decorators, same `bootstrap()`
- `@forinda/kickjs-auth`, `-swagger`, `-ws`, `-queue`, `-drizzle`, `-prisma`, `-testing`, `-devtools`, `-mcp`, `-ai`, `-vite`, `-cli`
- Context Contributors, `getRequestValue`, `bootstrap({ processHooks })` — all carried over from v4
- DI tokens, module system, typegen — no changes

## Step-by-step

### 1. Bump `@forinda/kickjs@^5`

```bash
pnpm up @forinda/kickjs@^5 @forinda/kickjs-cli@^5
```

If you were pinning `@forinda/kickjs-graphql`, `-otel`, `-cron`, `-mailer`, `-multi-tenant`, or `-notifications` — remove them from `package.json`:

```bash
pnpm rm @forinda/kickjs-graphql @forinda/kickjs-otel \
        @forinda/kickjs-cron @forinda/kickjs-mailer \
        @forinda/kickjs-multi-tenant @forinda/kickjs-notifications
```

### 2. Follow the BYO recipe for anything you were using

Open the guide page linked in the table above. Each recipe:

- Lists the upstream package you `pnpm add`
- Shows a ready-to-paste `defineAdapter` / `definePlugin` factory
- Calls out any conveniences the wrapper used to offer that you might want to inline
- Wires a DevTools tab via `devtoolsTabs()` so nothing feels missing

Typical migration per package is ~60 lines added to `src/adapters/` or `src/plugins/`.

### 3. Verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

All three should pass without changes to your existing code outside the removed imports.

## Why this release exists

Every dropped package was a thin bridge to a fast-moving ecosystem (OTel SDK releases, GraphQL server landscape, mailer APIs) where adopters consistently replaced the wrapper within weeks. Keeping a wrapper published cost us CI minutes and release friction; it cost adopters a layer of indirection they didn't need. v5 simply stops shipping the wrapper and ships the recipe instead.

`@forinda/kickjs` itself gained nothing new in v5 — the `processHooks` option, `getRequestValue`, context contributors, `defineAdapter` / `definePlugin`, and framework metadata helpers all landed in v4 and are the primitives the BYO recipes lean on.

## Related

- [v3 → v4 migration](./migration-v3-to-v4.md) — DI token convention + `@Controller` path removal
- [Framework comparison](https://github.com/forinda/kick-js/blob/main/comparison.md) — why the BYO split matters across the ecosystem
- [Adapters guide](./adapters.md) — the `defineAdapter` / `definePlugin` primitives the BYO recipes rely on
