---
'@forinda/kickjs': minor
---

Read `.env.test` instead of `.env` under a test run, so development env stops leaking into tests

KickJS loads dotenv as an import-time side effect with `override: false`. That
protects vars the test runner already pinned, but every var it _didn't_ pin was
silently backfilled from the developer's `.env` — so a suite could pin its
database URL and still reach live development services through the vars it
forgot, with nothing in the output saying so.

Env files now follow the cascade Vite popularised, where a mode-specific file
outranks every generic one (`[mode]` is `NODE_ENV`):

```
.env.[mode].local  >  .env.[mode]  >  .env.local  >  .env
```

Vars already in `process.env` still outrank all four, as before.

**Test mode is the deliberate exception.** When the mode is `test` and a
`.env.test` / `.env.test.local` exists, those are read and the generic `.env` /
`.env.local` are **not** — no layering, no fallback. Falling through is the
leak, and `.env.local` is excluded for the same reason: it holds one
developer's machine setup. `development` and `production` cascade normally,
where layering is expected and there is no dev-resource-in-a-test failure mode.

`KICKJS_ENV_FILE` replaces the cascade entirely — a comma-separated file list,
highest precedence first (`.env.ci,.env.shared`), or `off` to skip dotenv.

Apps with no mode files keep their exact current behaviour, plus a one-time
stderr warning under a test run naming what got backfilled.

Also fixed: `reloadEnv()` used an inline `dotenv.config()` that always read
`.env`, so an HMR reload could clobber pinned `.env.test` values; it now routes
through the same resolver as boot. And `resetEnvCache()` left
`Container._envResolver` installed over a null cache, making `@Value()` reads
indistinguishable from an unset key — it is now cleared.
