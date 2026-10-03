---
description: Controlling the environment a KickJS test suite runs with — .env.test, KICKJS_ENV_FILE, vi.stubEnv and withEnv for per-test values.
---

# Test Environment

Config is read once and cached, so where a test's values come from matters more than it seems. The short version:

| You need                                                | Use                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| values every test shares (secrets, URLs, feature flags) | [`.env.test`](#env-test-the-default)                                    |
| one test, or one block, with a different value          | [`withEnv`](#one-test-one-value-withenv)                                |
| a value only known at run time (a container's port)     | set `process.env` in Vitest's `globalSetup`, before the app is imported |
| full control over which files are read                  | [`KICKJS_ENV_FILE`](#kickjs-env-file-taking-manual-control)             |

## How config is read

Load order decides where a value can come from. Two things happen **before any
`beforeAll` runs**:

1. Importing `@forinda/kickjs` reads your env file into `process.env` as an
   import-time side effect.
2. Your `loadEnv(envSchema)` call parses `process.env` **once** and caches the
   result. `ConfigService.get()` and `@Value()` read that cached snapshot, not
   `process.env`.

So a var must be set before the module graph is imported. The reliable
placements are a `.env.test` file, your runner's `env` config, or a
`setupFiles` entry that runs first.

## One test, one value: `withEnv`

`withEnv(overrides, fn)` from `@forinda/kickjs` runs `fn` with some parsed values replaced. `getEnv()`, `ConfigService` and `@Value()` all see them, and the real ones come back afterwards, even if `fn` throws:

```ts
import { withEnv } from '@forinda/kickjs'

it('rejects sign-ups while registration is closed', async () => {
  await withEnv({ REGISTRATION_OPEN: false }, async () => {
    await t.client().post('/api/v1/signup').send(user).expect(403)
  })
})
```

The overrides are parsed values (`false`, `3`), not strings, because they skip the schema. No file is read. The env is process-wide, so don't use `withEnv` in tests that run concurrently. For contributors, `runContributor(dec, { env })` does the same ([Contributors](./contributors.md#context-contributors)).

## `.env.test`: the default

KickJS uses the same env-file cascade Vite popularised (see its "Env Variables
and Modes" guide): a mode-specific file outranks every generic one, and keys
found only in a generic file are still available.

```text
.env.[mode].local  >  .env.[mode]  >  .env.local  >  .env
```

`[mode]` is your `NODE_ENV`. Vars already in `process.env` outrank all four, so
what your shell or CI exports always wins. `*.local` files are for personal
machine overrides — add `*.local` to `.gitignore`.

::: warning What this does and does not protect against
`.env.test` closes one specific hole: values reaching your suite from an env
**file** it never meant to read. It is not a general guard against pointing a
test at the wrong resource.

Anything already in `process.env` — a var exported in your shell, set by your
CI job, or injected by a test-container runner — outranks every file and is
never reported by the backfill warning. That precedence is deliberate and is
what lets a runner hand your suite a throwaway database URL. It also means an
exported `DATABASE_URL` aimed at the wrong host is invisible here.

For that failure mode you want an explicit assertion at the point of use — a
few lines refusing to run against a database whose name isn't the test one
beat any amount of env plumbing, because they check the thing you actually
care about.
:::

**Test mode is the one exception.** Under a test run, if a `.env.test` or
`.env.test.local` exists, those are read and the generic `.env` / `.env.local`
are **not**. No layering, no fallback.

A run counts as a test run when `NODE_ENV=test` **or** Vitest's `VITEST` is set.
`VITEST` wins over a conflicting `NODE_ENV`, so a suite run with
`NODE_ENV=development` exported — from a shell profile or a CI image — still
gets test-mode isolation rather than your development files. To point a suite at
another mode's files deliberately, name them with `KICKJS_ENV_FILE`.

That short-circuit is deliberate. With a fallback, every var your test config
forgets to pin gets silently backfilled from your development `.env`: you can
pin your database URL and still reach live development services through the
vars you forgot, and nothing in the run tells you. `.env.local` is excluded for
the same reason — it is precisely the file holding one developer's machine
setup.

For `development` and `production` the layering is what you want (shared base
plus per-mode overrides) and there is no dev-resource-in-a-test failure mode to
guard against, so those cascade normally.

```bash
# .env.test — gitignored; the whole environment your suite runs against
NODE_ENV=test
DATABASE_URL=postgresql://test@localhost/myapp_test
LOG_LEVEL=silent
```

With no `.env.test` present, `.env` is read as before and KickJS prints a
one-time warning naming what it backfilled.

**Don't commit `.env.test`; commit `.env.test.example`.** Test values differ per
machine — one developer's database is `myapp_test`, another's runs on a
different port — so a tracked `.env.test` turns every local tweak into a diff,
and a merge conflict, for the whole team. `kick new` treats it like `.env`: it
writes `.env.test` for you, gitignores it along with `.env` and `*.local`, and
commits `.env.test.example` as the shared list of keys.

```bash
cp .env.test.example .env.test   # after cloning, next to cp .env.example .env
```

A fresh clone has neither `.env` nor `.env.test`, so nothing leaks. The one
exposed shape is a machine with a `.env` but no `.env.test` — the one-time
warning above and `kick doctor` both name it.

When you add a key to `.env.test`, add it to `.env.test.example` with a
placeholder value. Keep real credentials and live endpoints out of the example.
In CI, set test env in the job (or with `KICKJS_ENV_FILE=off`) rather than
relying on a file; `process.env` outranks every file. Compute per-run values (a
container's port, a worker-scoped database name) in your test config or setup
file, where they stay out of the repo.

## `KICKJS_ENV_FILE`: taking manual control

`KICKJS_ENV_FILE` replaces the whole cascade with a list you choose. It accepts
a comma-separated list of paths, **highest precedence first**, or `off` to skip
dotenv entirely:

```bash
# Skip env files completely — env comes from the shell, Docker, or a
# secret manager. Nothing on disk can leak in.
KICKJS_ENV_FILE=off vitest run

# One file, nothing else. Not even .env is consulted.
KICKJS_ENV_FILE=.env.ci vitest run
```

Order is precedence, so put the file that should win **first**. This is the
manual equivalent of the built-in cascade — a base file plus overrides layered
on top:

```bash
# .env.ci wins on conflicts; .env.shared supplies everything it omits.
KICKJS_ENV_FILE=.env.ci,.env.shared vitest run
```

```bash
# Three layers: a per-developer file beats the team's test defaults,
# which beat the shared base.
KICKJS_ENV_FILE=.env.test.local,.env.test,.env.shared vitest run
```

Reversing the list reverses the outcome — `.env.shared,.env.ci` lets
`.env.shared` win, which is usually not what you meant:

```bash
# ✗ Wrong way round — the base overrides your CI values.
KICKJS_ENV_FILE=.env.shared,.env.ci vitest run
```

Paths resolve relative to `process.cwd()`, so a monorepo can reach a file the
cascade would never find on its own — note that cwd is the **package** dir when
run through a workspace filter, not the repo root:

```bash
# Layer a repo-root file under the package's own.
KICKJS_ENV_FILE=.env.test,../../.env.shared pnpm --filter api test
```

Missing files in the list are skipped silently, so an optional local override
costs nothing:

```bash
# Works whether or not .env.test.local exists.
KICKJS_ENV_FILE=.env.test.local,.env.test vitest run
```

Set it per command as above, or pin it for a whole suite from the runner —
which also keeps it out of individual developers' shells:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    env: { KICKJS_ENV_FILE: '.env.ci,.env.shared' },
  },
})
```

One caveat: vars already present in `process.env` still outrank every file in
the list, `KICKJS_ENV_FILE` included. It picks which files are read, not whether
files beat the environment.

## `vi.stubEnv()` mid-suite

`vi.stubEnv()` mutates `process.env`, which is already too late for anything
read through `ConfigService` / `@Value()` — the parse happened at import. To
make a stub take effect, drop the cache and re-parse:

```ts
import { vi, beforeAll, afterAll } from 'vitest'
import { loadEnv, resetEnvCache } from '@forinda/kickjs'
import { envSchema } from '../src/env'

beforeAll(() => {
  vi.stubEnv('JWT_SECRET', 'test-secret-with-at-least-32-chars')
  resetEnvCache()
  loadEnv(envSchema)
})

afterAll(() => {
  vi.unstubAllEnvs()
  // `unstubAllEnvs()` restores process.env, but the cached parse still
  // holds the stub — drop it too, or a later test in the same worker
  // reads your stubbed value through ConfigService / @Value().
  resetEnvCache()
  loadEnv(envSchema)
})
```

Your stub has to satisfy the schema: `loadEnv(envSchema)` re-validates, so a
`JWT_SECRET` declared `z.string().min(32)` rejects a 30-character placeholder.

`vi.stubEnv()` alone is still correct for code that reads `process.env`
directly.
