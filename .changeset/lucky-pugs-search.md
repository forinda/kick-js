---
'@forinda/kickjs': minor
---

Read `.env.test` instead of `.env` under a test run, so development env stops leaking into tests

KickJS loads dotenv as an import-time side effect with `override: false`. That
protects vars the test runner already pinned, but every var it _didn't_ pin was
silently backfilled from the developer's `.env` — so a suite could pin its
database URL and still reach live development services through the vars it
forgot, with nothing in the output saying so.

Now, when `NODE_ENV=test` (or Vitest's `VITEST` is set) and a `.env.test` exists
in `process.cwd()`, that file is read and `.env` is **not**. No cascade — falling
through to `.env` is the leak. Set `KICKJS_ENV_FILE` to a comma-separated file
list, or `off`, to override the choice.

Apps with no `.env.test` keep their exact current behaviour, plus a one-time
stderr warning naming what got backfilled.

Also fixed: `reloadEnv()` used an inline `dotenv.config()` that always read
`.env`, so an HMR reload could clobber pinned `.env.test` values; it now routes
through the same resolver as boot. And `resetEnvCache()` left
`Container._envResolver` installed over a null cache, making `@Value()` reads
indistinguishable from an unset key — it is now cleared.
