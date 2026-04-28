# kickjs-skills.md — Task Skills for AI Agents (task-kickdb-api)

This file is the agent-facing **skills index** for KickJS work in this
repo. Each block below is a short, rigid workflow keyed to a specific
trigger ("user wants to add a module", "tests are leaking state", etc.).

- Reference docs (narrative, exhaustive) → `AGENTS.md`.
- Tool-specific notes → `CLAUDE.md`, `GEMINI.md`, etc.
- **This file** → step-by-step recipes the agent should _execute_.

Re-run `kick g agents -f --only skills` after framework upgrades to refresh.

---

## Skill: add-module

```yaml
name: kickjs-add-module
description: Use when the user asks to add a new feature module (controller + service + repo + DTOs).
```

**Trigger phrases**: "add a users module", "scaffold tasks", "new feature for X".

**Steps**:

1. Run `kick g module <name>` (use plural form if the project pluralizes — check `kick.config.ts`).
2. Verify the new folder under `src/modules/<name>/` contains `<name>.module.ts` (filename suffix is mandatory for HMR).
3. Confirm the module appears in `src/modules/index.ts` exports — generator does this automatically; verify if you bypassed it.
4. Open `<name>.dto.ts` and tighten the Zod schemas to real fields (the generator emits placeholders).
5. Run `pnpm run typecheck` and `pnpm run test` before claiming done.

**Red flags** (stop and ask):

- File created as `<name>.ts` instead of `<name>.module.ts` — Vite won't HMR it.
- Module not registered in `src/modules/index.ts`.
- `@Controller('/path')` with a path argument — that's a v3 pattern; remove it (mount comes from `routes().path`).

---

## Skill: add-adapter

```yaml
name: kickjs-add-adapter
description: Use when wiring a new lifecycle integration (Swagger, DevTools, Auth, custom).
```

**Steps**:

1. `kick g adapter <name>` to scaffold the boilerplate, OR install via `kick add <package>` for first-party adapters.
2. The generated file uses `defineAdapter()` — never `class implements AppAdapter`.
3. Add the adapter instance to `src/adapters/index.ts` (don't inline in `src/index.ts`).
4. If the adapter contributes to `ctx.set/get`, prefer `AppAdapter.contributors?()` over a wrapping middleware.
5. Verify with `kick dev` that the adapter's lifecycle logs fire.

**Red flags**:

- Inlining the adapter list directly in `src/index.ts` (entry file should stay thin).
- Returning a plain object instead of going through `defineAdapter()` — type inference for `config` will be wrong.

---

## Skill: write-controller-test

```yaml
name: kickjs-write-controller-test
description: Use when adding a Vitest test that exercises an HTTP route or DI graph.
```

**Template** (copy/paste, adjust):

```ts
import { describe, it, expect } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

describe('UserController', () => {
  it('returns users', async () => {
    const container = Container.create() // isolated DI per test
    const app = await createTestApp([UserModule], { container })
    const res = await app.get('/users')
    expect(res.status).toBe(200)
  })
})
```

**Red flags**:

- `new Container()` — wrong; use `Container.create()`.
- `Container.getInstance().reset()` — wrong; same fix.
- Sharing a container across `it()` blocks — leaks registrations.

---

## Skill: env-wiring-check

```yaml
name: kickjs-env-wiring-check
description: Use when ConfigService.get('SOME_KEY') returns undefined or @Value silently falls back to process.env.
```

**Diagnosis**:

1. Open `src/index.ts`. The **first non-`reflect-metadata`** import MUST be `import './config'`.
2. Open `src/config/index.ts`. It MUST call `loadEnv(envSchema)` as a top-level side effect.
3. The new key MUST be declared in the Zod schema there. `@Value('NEW_KEY')` won't work without a schema entry (it'll fall back to raw `process.env` and skip Zod coercion silently).

**Fix**: add the key to the schema; ensure both side-effect imports above are present.

---

## Skill: bootstrap-export

```yaml
name: kickjs-bootstrap-export
description: Use when HMR is silently doing full restarts on every save, or createTestApp can't find the app handle.
```

**Check** `src/index.ts`'s last line:

```ts
// CORRECT
export const app = await bootstrap({ ... })

// WRONG (HMR degrades to full restart, createTestApp loses the handle)
await bootstrap({ ... })
```

The Vite plugin imports the named `app` symbol; testing helpers do too.

---

## Skill: thin-entry-file

```yaml
name: kickjs-thin-entry-file
description: Use when src/index.ts is accumulating module/middleware/plugin/adapter literals.
```

**Refactor target**:

```ts
// src/modules/index.ts
export const modules: AppModuleClass[] = [HelloModule, UsersModule, ...]

// src/middleware/index.ts
export const middleware = [helmet(), cors(), requestId(), ...]

// src/plugins/index.ts
export const plugins = [MetricsPlugin(), ...]

// src/adapters/index.ts
export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]

// src/index.ts — stays small
import 'reflect-metadata'
import './config'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { middleware } from './middleware'
import { plugins } from './plugins'
import { adapters } from './adapters'
export const app = await bootstrap({ modules, middleware, plugins, adapters })
```

**Red flags**: any `new SomeAdapter()` or `SomePlugin()` literal inside `bootstrap({ ... })` instead of imported from a category folder.

---

## Skill: context-contributor

```yaml
name: kickjs-context-contributor
description: Use when a middleware's only job is to set ctx values consumed elsewhere — replace with defineHttpContextDecorator (HTTP) or defineContextDecorator (transport-agnostic).
```

**Pattern** (HTTP — most common):

```ts
import { defineHttpContextDecorator, type RequestContext } from '@forinda/kickjs'

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  resolve: (ctx, { repo }) => repo.findById(ctx.req.headers['x-tenant-id'] as string),
})

const LoadProject = defineHttpContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],
  resolve: (ctx) => projectsRepo.find(ctx.get('tenant')!.id, ctx.params.id),
})

@LoadTenant
@LoadProject
@Get('/projects/:id')
getProject(ctx: RequestContext) { ctx.json(ctx.get('project')) }
```

Use `defineContextDecorator` (no Http prefix) when authoring a contributor that must run across HTTP, WebSocket, queue, and cron transports — `Ctx` defaults to the smaller `ExecutionContext` surface (`get` / `set` / `requestId` only, no `req`).

Precedence high → low: **method > class > module > adapter > global**.
Cycles or unmet `dependsOn` keys throw `MissingContributorError` at boot.

**Critical rules — all stem from the same shared-via-ALS instance model**:

- Every per-request stage (middleware → contributors → handler) gets its OWN `RequestContext` instance, but they all read/write the SAME `AsyncLocalStorage`-backed bag.
- **`resolve` and `onError` must RETURN the value** — the runner writes it via `ctx.set(key, value)`. Direct property assignment (`ctx.tenant = …`) sticks to one instance only and the handler instance never sees it.
- `ctx.set('tenant', x)` then `ctx.get('tenant')` works across instances. `ctx.req.headers[...]` works (the underlying Express request is shared).
- Services with no `ctx` reference: `getRequestValue('tenant')` returns `MetaValue<'tenant'> | undefined` (typed via the augmented `ContextMeta`). For `requestId` use `getRequestStore()`.
- **No `setRequestValue` — writes flow through `ctx.set` or a contributor's return value.** Avoids "spooky action at a distance" where any service can pollute the per-request bag.

**Don't use this for**: response short-circuit, stream mutation, or
pre-route-matching work — keep `@Middleware()` for those.

---

## Skill: refresh-agent-docs

```yaml
name: kickjs-refresh-agent-docs
description: Use after a KickJS version bump to sync AGENTS.md / CLAUDE.md / kickjs-skills.md with the latest CLI templates.
```

**Steps**:

1. `kick g agents -f --only both` — overwrites `AGENTS.md` and `CLAUDE.md`.
2. `kick g agents -f --only skills` — refreshes `kickjs-skills.md` (this file).
3. Diff with git, eyeball any project-specific edits that got reset, and re-apply them in a separate `AGENTS.local.md` or appended section.
4. Commit as `docs(agents): sync from CLI vX.Y`.

---

## Skill: deny-list

```yaml
name: kickjs-deny-list
description: Patterns to refuse outright when the user asks for them — they break v4 invariants.
```

- `class implements AppAdapter` → use `defineAdapter()`.
- `class implements KickPlugin` / function returning `KickPlugin` → use `definePlugin()`.
- `@Controller('/path')` with a path argument → drop the path; set the mount via `routes().path`.
- `new Container()` or `Container.getInstance().reset()` in tests → use `Container.create()`.
- DI tokens with `:` separator (`'app:db:url'`) or in PascalCase → use slash-delimited lower-case (`'app/db/url'`).
- `bootstrap({ ... })` without `export const app = ...` → always export.
- Module file named `<name>.ts` (no `.module` suffix) → rename to `<name>.module.ts`.

---

## Learn More

- [KickJS Docs](https://forinda.github.io/kick-js/)
- [Decorators](https://forinda.github.io/kick-js/guide/decorators.html)
- [Context Decorators](https://forinda.github.io/kick-js/guide/context-decorators.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
