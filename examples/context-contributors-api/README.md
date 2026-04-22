# context-contributors-api

A minimal KickJS example demonstrating **all five Context Contributor registration sites** in one app — the typed, ordered, declarative primitive that replaces hand-written middleware whose only job is to populate `ctx.set('key', value)` for the handler.

See the [Context Decorators guide](https://forinda.github.io/kick-js/guide/context-decorators) for the conceptual reference. This README maps each piece of code to the corresponding registration site.

## What's wired

| Site | Where in this app | What it produces |
|------|-------------------|------------------|
| **global** | `src/index.ts` — `bootstrap({ contributors: [StartedAt] })` | `ctx.get('requestStartedAt')` |
| **adapter** | `src/adapters/flags.adapter.ts` — `FlagsAdapter.contributors()` | `ctx.get('flags')` |
| **module** | `src/modules/projects/projects.module.ts` — `ProjectsModule.contributors()` | `ctx.get('auditTrailEnabled')` |
| **class** | `src/modules/projects/projects.controller.ts` — `@LoadTenant` on the class | `ctx.get('tenant')` |
| **method** | `src/modules/projects/projects.controller.ts` — `@LoadProject` on `getOne` | `ctx.get('project')` |

Precedence (locked in `architecture.md` §20.4) is **method > class > module > adapter > global**. Same-key collisions are silent overrides — the higher-precedence contributor wins.

## Run it

```bash
pnpm install
pnpm --filter @forinda/kickjs-example-context-contributors-api dev
```

Then:

```bash
# All five contributors fired — response body shows every key
curl http://localhost:3000/api/v1/projects/p-1

# Method-level @LoadProject is scoped to getOne; this route shows the
# other four keys but `project` is undefined
curl http://localhost:3000/api/v1/projects/
```

## File map

```
src/
├── index.ts                            # bootstrap (global contributor)
├── types.d.ts                          # ContextMeta augmentation (typed get/set)
├── contributors/
│   └── index.ts                        # all five contributors in one file
├── adapters/
│   └── flags.adapter.ts                # adapter contributor (LoadFlags)
└── modules/
    ├── index.ts                        # module registry
    └── projects/
        ├── projects.module.ts          # module contributor (LoadAuditTrail) + register/routes
        ├── projects.controller.ts      # class @LoadTenant + method @LoadProject + handlers
        ├── projects.repo.ts            # in-memory data + DI token
        └── projects.test.ts            # supertest verifying all five keys reach the handler
```

## Key things to notice

1. **Type augmentation.** `src/types.d.ts` declares `ContextMeta` so `ctx.get('tenant')` returns `{ id: string; name: string }` instead of `unknown`. Without that file, the runtime works the same but you lose type safety at the call site.

2. **`dependsOn` enforces order.** `LoadProject` declares `dependsOn: ['tenant']`. The framework topo-sorts at route mount time so `LoadTenant` always runs first. Cycles or missing dependencies fail `app.setup()` — bad pipelines never reach a request.

3. **DI flows through `deps`.** `LoadProject` declares `deps: { repo: PROJECTS_REPO }` and the runner resolves `PROJECTS_REPO` against the container before calling `resolve()`. Same DI tokens you use everywhere else; no special wiring.

4. **Module-level isolation.** Module contributors apply only to routes the module mounts. Adding a second module would not see `auditTrailEnabled` unless that module declared its own.

5. **Per-request isolation.** Each request gets its own `ctx.values` map (post-Phase 3 unification). Two requests to `/projects/p-1` in flight at the same time see independent `tenant` and `project` values, never each other's.
