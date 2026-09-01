# Migrating to v8

v8 is a major bump for one reason: **two responses your app produces without asking for them changed shape**. Everything else in the release is a fix, an addition, or a warning — but those two are enough to break a client that asserts on them, so the version number says so.

If nothing in your codebase asserts on the body of a 404, and no client of yours treats "wrong verb on a known path" as a 404, the upgrade is `pnpm install` and ship.

```bash
pnpm add @forinda/kickjs@8
```

::: tip All three go to 8
Versions are per-package and independent, but the three you install directly bump together — `@forinda/kickjs`, `@forinda/kickjs-testing` and `@forinda/kickjs-cli` are each **8.0.0**. The harness renames an option alongside the framework; the CLI drops three `kick add` entries.

Other packages move on their own numbers in the same release and need nothing from you: `-devtools` 7.1.2, `-devtools-kit` 7.0.2, `-grpc` 0.1.1, `-mcp` 7.0.2, `-queue` 7.0.2, `-schema` 0.1.4, `-swagger` 7.1.1. Upgrade any you use with `@latest`.

```bash
pnpm add -D @forinda/kickjs-testing@8 @forinda/kickjs-cli@8
```

:::

## At a glance

| Change                                          | Affects                     | Action                                              |
| ----------------------------------------------- | --------------------------- | --------------------------------------------------- |
| `kickjs-auth`, `-drizzle`, `-prisma` removed    | Apps still on them          | Move to BYO auth or kick/db                         |
| `kick add auth\|drizzle\|prisma` now fails      | Anyone scripting `kick add` | Drop those from setup scripts and CI                |
| `middleware` option renamed to `middlewares`    | Any app setting it          | Rename the key — the compiler finds every one       |
| 404 body is now problem details                 | Any app                     | Read `title`/`status`, or restore with `onNotFound` |
| Every `HttpException` is problem details        | Any app                     | Read `detail`/`status`, not `message`               |
| Wrong verb answers 405, not 404                 | Any app                     | Move the case to the 405 branch                     |
| Health probes moved inside the middleware chain | Apps with global auth       | Exempt the path, or `health: false`                 |
| `/health/ready` answers instead of 500          | Fastify / h3                | None — the probe was permanently failing            |
| Malformed body answers 400                      | h3 only                     | None — it was answering 200                         |
| `./web` entry answers 400 for a malformed body  | Edge / Bun / Deno           | None — it was answering 200                         |
| Rejected upload answers 413/415                 | Express only                | None — it was answering 500                         |
| `csrf`, `rateLimit`, `session` now work         | Fastify / h3                | Re-test — they used to throw                        |
| Forms, `+json` and `text/*` now parse           | Any app                     | Re-check handlers that guarded on `!ctx.body`       |
| `helmet()` options now take effect              | Apps passing helmet options | Re-check which security headers you send            |
| `@PreDestroy` on a singleton warns              | Any app                     | Move teardown to an adapter `shutdown()`            |

## Removed: the auth, Drizzle and Prisma packages

`@forinda/kickjs-auth`, `@forinda/kickjs-drizzle` and `@forinda/kickjs-prisma` are gone, and `kick add auth|drizzle|prisma` no longer offers them.

None had shipped in a long time: all three were frozen at **6.0.1** while the framework moved to 7.4, so `kick add auth` installed a package two majors behind the kickjs it was joining. v8 finishes what those deprecation warnings started.

| removed                   | replacement                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `@forinda/kickjs-auth`    | [BYO Auth recipe](./byo-recipes.md#auth)                                                   |
| `@forinda/kickjs-drizzle` | `@forinda/kickjs-db` (`kick add db` / `pg` / `sqlite` / `mysql`), or wire Drizzle directly |
| `@forinda/kickjs-prisma`  | `@forinda/kickjs-db`, or wire Prisma directly                                              |

**The auth decorators went with the package.** `@Public`, `@Roles`, `@Can`, `@Authenticated`, `AuthAdapter` and `AUTH_USER` lived in `@forinda/kickjs-auth` — never in the framework core, though `@Public` reads like a framework decorator. If you use any of them, the [BYO Auth recipe](./byo-recipes.md#auth) rebuilds each one from `defineContextDecorator` and `defineAdapter`, in roughly 200 lines you own.

The npm versions stay published. Nothing uninstalls itself, and an app pinned to `6.0.1` keeps working against kickjs 7 — it just cannot come with you to 8.

## Breaking: `middleware` is now `middlewares`

`bootstrap()` took both — `middlewares` as the real name, `middleware` as a deprecated alias that the plural beat when both were set. v8 drops the alias, so there is one name for one thing:

```ts
bootstrap({
  modules,
  middlewares: [helmet(), cors(), requestId()], // was: middleware
})
```

This is the least dangerous change in the release: `middleware` is no longer a key on `ApplicationOptions`, so passing it is a **type error**, not a silently ignored object. Rename and the compiler confirms you got them all.

Renamed for the same reason, in the same release:

| call            | was          | now           |
| --------------- | ------------ | ------------- |
| `bootstrap`     | `middleware` | `middlewares` |
| `createTestApp` | `middleware` | `middlewares` |
| `createWebApp`  | `middleware` | `middlewares` |

`createTestApp` passes the option straight through to `bootstrap()`, so a harness whose option name disagreed with the thing it configures was exactly the inconsistency being removed — that is why `@forinda/kickjs-testing` takes a major too.

**`AppAdapter.middleware()` and `Plugin.middleware()` are unchanged.** Those are a different API — a hook that returns entries, not an option that takes them — and nothing about them was ambiguous. If you write adapters, nothing there moves.

## Breaking: every error is problem details

A plain `HttpException` used to answer a bare `{ "message": … }` with `application/json`. It now emits RFC 9457, the same as `ProblemException` and `ctx.problem.*`:

```ts
throw HttpException.forbidden('Not your project')
```

```json
403  content-type: application/problem+json
{ "type": "about:blank", "title": "Forbidden", "status": 403, "detail": "Not your project" }
```

`HttpException` was the last shape a client parsing `application/problem+json` had to special-case — and the most common one, since it is how most apps reject a request. Route validation raises `HttpException` too, so 422 bodies move with it: `details` becomes an `errors` extension member, still withheld in production.

**If you assert on `body.message`, read `body.detail`.** The message is not lost; it is the `detail` field.

## Breaking: the catch-all

### The 404 body

It was `{ "message": "Not Found" }`. It is now RFC 9457 problem details, served as `application/problem+json`:

```json
{ "type": "about:blank", "title": "Not Found", "status": 404 }
```

The catch-all was the last response still emitting a bare `{ message }`. Every `ProblemException` the framework raises already returned problem details, so a client parsing that format had to special-case exactly one path — this one.

**If you assert on it**, read `body.title` or `body.status`:

```ts
// v7
expect(res.body.message).toBe('Not Found')

// v8
expect(res.body.title).toBe('Not Found')
expect(res.status).toBe(404)
```

**If you need the old shape**, `onNotFound` still wins and always did:

```ts
bootstrap({
  modules: [AppModule],
  // `req.path` is Express-only — read `req.url` so this holds on every runtime.
  onNotFound: (req, res) => res.status(404).json({ message: 'Not Found' }),
})
```

An app that already passes `onNotFound` or `onError` is unaffected by this entire section.

### Wrong verb is now 405

A known path called with an unsupported method answers 405 with `Allow`, as RFC 9110 §15.5.6 requires:

```
DELETE /api/v1/things/1     405   Allow: GET, PATCH

{ "type": "about:blank", "title": "Method Not Allowed", "status": 405,
  "detail": "DELETE is not supported for this resource. Allowed: GET, PATCH." }
```

A 404 there told the client to stop looking for a resource that is present. This is the correct answer, but it moves the case from one branch to another — a client with `if (res.status === 404) handleMissing()` now falls through.

The handler reads the mounted route table, so `Allow` reflects the real path, prefix and version as mounted.

## Health probes moved

`GET /health/live` and `GET /health/ready` were mounted straight onto the engine, ahead of the middleware chain. They are now a real module — `healthModule()` — registered automatically. Paths and bodies are unchanged.

**What this changes for you:** the probes now sit _inside_ the middleware chain. **An app with global auth will require auth on its probes.**

That is the correct default — your app controls its own auth, and a framework route quietly bypassing it is the surprise — but it will fail a liveness check the first time it runs. Exempt the path as you would any other:

```ts
// in your auth middleware — `req.path` is Express-only, so read `req.url`
if (req.url?.startsWith('/health')) return next()
```

Or turn the built-in off and mount your own:

```ts
bootstrap({ modules: [AppModule, MyHealthModule()], health: false })
```

The upside of the move: the probes now appear in the OpenAPI spec, in `logRouteTable`, and in the route registry — three places they were invisible before. They read draining state and adapter checks through a `HEALTH_PROBE` token, so a replacement module can satisfy the same contract.

`ModuleRoutes` gains `prefix?: false` for this, and it is useful beyond health — a provider's fixed webhook URL or a `/.well-known` document has the same problem of being dragged around by a prefix that has nothing to do with it:

```ts
routes() {
  return { path: '/.well-known', controller: WellKnownController, version: false, prefix: false }
}
```

That completes the URL-shape matrix. Both segments are now droppable at either scope:

|           | drop `/v{n}`                           | drop `/{apiPrefix}`                         |
| --------- | -------------------------------------- | ------------------------------------------- |
| whole app | `bootstrap({ defaultVersion: false })` | `bootstrap({ apiPrefix: '' })`              |
| one mount | `version: false` on `ModuleRoutes`     | `prefix: false` on `ModuleRoutes` **(new)** |

`defaultVersion: false` is not new — it shipped in **7.4.0** — but it is worth knowing next to the per-mount flag, because the two are read together and the per-mount value always wins over the app default, in either direction. `version: false` drops only the version segment and still lands the module under `/api`; `prefix: false` mounts at `path` exactly.

## Fixes that change what you observe

These are patches, not breaks — but each one changes a response you may have built around.

### Fastify / h3: `/health/ready` answered 500

The built-in health routes used `ctx.res.status(code).json(body)` in three of their four branches. `ctx.res` is the _engine-native_ response — under Fastify a `FastifyReply`, which has `.status()` but no `.json()` — so those branches threw and the error handler answered 500.

**Readiness probes therefore failed permanently on Fastify.** A pod never becomes ready, which blocks a deployment rather than degrading it. Both draining branches had the same defect, and they fire during exactly the shutdown window they exist to cover.

It stayed invisible because the one branch using the neutral `ctx.json()` is the happy path of `/health/live` — which is what a smoke test curls.

All four branches now `return reply(status, body)`. If you worked around this with your own readiness route, the built-in one is worth reclaiming — see [health probes moved](#health-probes-moved) above for where it now mounts.

### h3: a malformed body answered 200

The h3 runtime read bodies with `readBody(event).catch(() => undefined)`. The catch was there for the legitimate absent-body case, but it swallowed a _parse failure_ just as readily, so broken JSON produced a 200 with the handler running against `undefined`.

| runtime | malformed JSON, v7     | v8    |
| ------- | ---------------------- | ----- |
| express | `400`                  | `400` |
| fastify | `400`                  | `400` |
| h3      | **`200 {"got":null}`** | `400` |

Worse than the wrong status: the client was told it succeeded, and a create endpoint would write whatever its defaults were. The runtime now decides on `content-length` / `transfer-encoding` rather than on whether parsing threw, and normalises the content type — `application/json; charset=utf-8` previously fell to a non-strict branch and handed the handler a raw string.

An h3 app that was silently accepting bad payloads will start rejecting them. That is the fix.

### The `./web` entry answered 200 for a malformed body

`h3WebRuntime` — the entry for edge, Bun and Deno — read JSON with
`request.json().catch(() => undefined)`, which cannot tell an **absent** body
from an **unparseable** one. Broken JSON produced a `200` with the handler
running against `undefined`.

It is the same defect fixed for the node h3 runtime above; that fix did not
reach here, because the web entry has its own body-reading path. If you deploy
to an edge runtime, this is the fix most likely to change what your app does:
requests you were silently accepting now answer 400.

### Express: a rejected upload answered 500

`@FileUpload` enforces `maxSize` and `allowedTypes` through a different backend per engine, and only two of the three reported a violation as the client's:

| upload          | express, v7                             | v8    | fastify / h3 |
| --------------- | --------------------------------------- | ----- | ------------ |
| over `maxSize`  | **500** with a Multer stack in the body | `413` | `413`        |
| disallowed type | **500**                                 | `415` | `415`        |

One difference remains, documented rather than papered over: on a 413 Express names the form **field** where the others name the **file**, because Multer's error carries no filename. Status and limit are identical.

### Fastify / h3: `csrf`, `rateLimit` and `session` were broken

Connect middleware receives an Express response under Express and a raw `ServerResponse` under Fastify and h3. Three shipped middlewares reached for Express-only conveniences on it:

| middleware  | v7 on Fastify / h3                                                                     |
| ----------- | -------------------------------------------------------------------------------------- |
| `csrf`      | threw before any check ran — **every request became a 500**                            |
| `rateLimit` | threw once the limit was hit, leaving the request **hanging** instead of answering 429 |
| `session`   | threw on every response issuing a session, so no cookie was ever set                   |

`csrf` had a second problem on every runtime: it read the token from `req.cookies`, which only an upstream cookie parser populates. It could not see the cookie it had just issued, so **the double-submit flow could never succeed anywhere**. Cookies are now read through a shared helper that falls back to parsing the `Cookie` header.

If you mounted any of these on Fastify or h3, they now do what they always claimed to. Re-run the suites that were passing around them.

### Bodies parse the same way on every runtime

Each engine used to bring its own library's opinion about content types, so the same request produced three different results:

| body sent                           | v7 Express  | v7 Fastify | v7 h3          | v8, all three      |
| ----------------------------------- | ----------- | ---------- | -------------- | ------------------ |
| `application/x-www-form-urlencoded` | `undefined` | **415**    | parsed         | **parsed**         |
| `application/merge-patch+json`      | `undefined` | **415**    | parsed         | **parsed as JSON** |
| malformed `+json`                   | `undefined` | 415        | **raw string** | **400**            |
| `text/plain`                        | `undefined` | `'hello'`  | `'hello'`      | **`'hello'`**      |

That made `bootstrap({ runtime })` not actually swappable for any app accepting a body outside `application/json` — moving Express → Fastify turned every form post into a 415.

The framework now decides in one place. `application/json` and `application/*+json` parse strictly; `application/x-www-form-urlencoded` parses to an object; `text/*` arrives as a **raw string**; `multipart/*` continues through the upload path.

`+json` is not a liberty: RFC 6838 §4.2.8 says a media type "MUST NOT" carry a structured-syntax suffix it does not actually use, and RFC 6839 §2 exists so receivers can generically parse it. Spring, ASP.NET Core and Hono do the same. It also means the framework can finally read back the `application/problem+json` it emits.

::: warning `text/*` is never JSON-parsed, deliberately
`text/plain` is one of three CORS-safelisted content types — it crosses origins **without a preflight**. JSON-parsing it would re-open the simple-request CSRF that requiring `application/json` closes. If a client sends JSON as `text/plain` (which `fetch(url, { body: JSON.stringify(x) })` does when you set no headers), fix the client's `Content-Type`.
:::

**What to re-check:** handlers that treated `!ctx.body` as "no form data" on Express, or relied on Fastify's 415 for forms. Both now receive a parsed body.

**A type outside that set is now rejected.** A body the framework cannot read answers **415** with an `Accept` header naming what it accepts, on every runtime — where Express previously handed the handler `undefined` and let it fail somewhere less obvious.

The rejection is for a body that cannot be read, never for the absence of one: a bodyless `POST` succeeds whatever its declared type.

```text
POST /things   Content-Type: application/xml   <a>1</a>
415   Accept: application/json, application/*+json, application/x-www-form-urlencoded, text/*, multipart/form-data

POST /things   Content-Type: application/xml   (no body)
200
```

If you have an Express app that accepted an unusual content type and ignored the body, it now answers 415. Handle the type, or stop sending the header.

### `helmet()` options were being ignored

`bootstrap()` auto-injects `helmet()` with defaults, and it did so _ahead of_ your middleware array. So an app declaring its own helmet ran two — and the second can only overwrite a header, never drop one:

```ts
bootstrap({ middlewares: [helmet({ frameguard: false })] })
// v7: still X-Frame-Options: DENY
// v8: header absent, as asked
```

Every `false` option behaved this way — `frameguard`, `hsts`, `referrerPolicy`, `noSniff`. Each was accepted, type-checked, and silently did nothing, because the automatic pass had already set the header.

**This is the one fix in the release that can remove a security header you are currently sending.** If you pass options to `helmet()`, list them and confirm you meant each one — in v7 an option that disabled a header did nothing, so an app may be relying on a header it explicitly asked to turn off. Nothing changes for an app that passes `helmet()` bare or declares none.

A helmet scoped to one path is unaffected — auto-injection only stands down for an app-wide `helmet()`, so a `{ path, handler }` entry does not strip headers from your other routes.

### `@PreDestroy` on a singleton now warns

`@PreDestroy` fires when a REQUEST scope closes. On a SINGLETON — the default scope — nothing closes, so the hook is inert. It was _silently_ inert, which is a trap because `@PostConstruct` **does** run for singletons: the pair reads as init/teardown while one half quietly opts out.

Applying it to a non-REQUEST service now logs once at startup:

```text
kickjs: @PreDestroy on DatabaseService (singleton) will never run — that hook
fires only when a REQUEST scope closes.
For application-lifetime resources, release them from an adapter's shutdown()
hook instead.
```

Nothing breaks — but if you see this, the teardown you thought you had has never run. Move it to an adapter:

```ts
const dbAdapter: AppAdapter = {
  name: 'db',
  async shutdown() {
    await pool.end()
  },
}
```

## New in v8

Additive — nothing to migrate, but these remove workarounds you may be carrying.

**A config-less module factory can be passed uninvoked.** `new factory()` used to die with `TypeError: entry is not a constructor`, naming neither the module nor the fix.

```ts
bootstrap({ modules: [TodosModule] }) // now equivalent to TodosModule()
```

A _configurable_ module still refuses the bare form, because there the two are not equivalent in intent — the bare name silently selects the defaults, and an author who meant `TenantModule({ region })` would get a running app wired the wrong way with nothing said.

**`LoggedRequest` / `LoggedResponse` are exported.** The documented "keep `src/index.ts` thin" layout builds the middleware array in its own file and exports it with an inferred type, which used to fail with `TS4023: ... cannot be named`. It compiles now.

**`createTestApp` runs the engine you deploy** (`@forinda/kickjs-testing`). The harness hardcoded Express, so a project running Fastify or h3 in production had its whole suite passing against a different engine — and routing, body parsing, status handling and error mapping all live in the runtime seam.

It also no longer names its own middleware list, so a test app now gets the Application's real defaults — including the body-parsing policy above. Previously a test app parsed only `application/json` while the same app in production parsed the full set, so the harness was quietly exercising a different pipeline. **A test that posts an unusual content type will now see the same 415 your users would.**

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

const { app } = await createTestApp({ modules: [UserModule], runtime: fastifyRuntime() })
const res = await request(app.handle.bind(app)).get('/api/v1/users')
```

Drive the returned `app`, not `expressApp` — `app.handle` follows whichever runtime is configured. The default middleware follows the runtime too: it is now empty on a runtime with native body parsing, because passing `express.json()` there bypasses the Application's own guard and hangs a JSON POST until the test times out.

**`overrides` accepts a token.** `createToken()` returns a frozen object, which TypeScript rejects as a computed key — so the one key type most worth overriding in a test was the one shape `overrides` could not take. The `[TOKEN.name]` workaround was worse than the error: it compiled, and the container keys tokens by reference, so the override was accepted and silently never applied. Pass entries or a `Map` instead:

```ts
const { app } = await createTestApp({
  modules: [UserModule],
  overrides: [[DATABASE, fakeDb]],
})
```

## CLI (`@forinda/kickjs-cli` 8.0)

**Why the CLI is also a major:** `kick add auth`, `kick add drizzle` and `kick add prisma` no longer install anything — the three entries are gone from the catalog with their packages, so those commands now report an unknown package. Everything else below is additive or a fix.

- **The generated repository is one file.** `<module>.repository.ts` now holds the factory, the contract (`ReturnType` of the factory) and the token. Previously three files, with the store name baked into the class — `PostgresAuditRepository` whose every method read and wrote a `Map`. The store is gone from the generated names, so an in-memory body is honest and the TODO says what to swap in.
- **`modules.repo` in `kick.config.ts` is deprecated.** It only ever selected a name for the lie above. Remove it; the generator no longer needs it.
- **`kick typecheck` refreshes generated types first.** `kick dev` always did, so the two disagreed the moment a route changed.
- **`kick g adapter` scaffolds every `AppAdapter` hook** and stops describing the middleware hook as Express-only.
- **Generated controller tests assert something.** Every case used to be `expect(true).toBe(true)`.
- **Generated project docs stop calling the bare module form an error.** They listed `bootstrap({ modules: [TodosModule] })` as a red flag — which is now the supported form for a config-less module, as above.
- **Generated docs and `kick explain` stop teaching the Express-only test pattern**, matching `createTestApp`'s new `runtime` option.

## Upgrade checklist

1. `pnpm add @forinda/kickjs@8` and `pnpm add -D @forinda/kickjs-testing@8 @forinda/kickjs-cli@8`.
2. If you depend on `kickjs-auth`, `-drizzle` or `-prisma`, move off them first — auth is the big one, and the BYO recipe is a copy-paste starting point.
3. Rename `middleware:` to `middlewares:` at every `bootstrap`, `createTestApp` and `createWebApp` call — then typecheck; anything missed is an error, not a silent no-op.
4. Grep your tests and clients for `'Not Found'` — assert on `title`/`status`, or pass `onNotFound`.
5. Grep for 404 handling that covers the wrong-verb case; split out 405.
6. If you have global auth, exempt `/health` or pass `health: false`.
7. Boot the app and read the startup log for a `@PreDestroy` warning.
8. On Fastify or h3: re-test anything that mounted `csrf`, `rateLimit` or `session`.
9. If you pass options to `helmet()`, re-read them — they take effect now, and a header you disabled in v7 was still being sent.
10. Point `createTestApp` at your production runtime and run the suite again — that is the check that catches everything above at once.

## Older migrations

- [Migrating v3 → v4](./migration-v3-to-v4.md) — first-party DI tokens moved from `Symbol(...)` to `createToken<T>()`, and `@Controller('/path')` was removed.
- [Pluggable Runtimes](./migration-runtimes.md) — moving an Express-only app onto Fastify or h3.
- [Migration from Express](./migration-from-express.md) — arriving from a plain Express app.
