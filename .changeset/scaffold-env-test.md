---
'@forinda/kickjs-cli': minor
---

Scaffold `.env.test` in `kick new`, and gitignore `*.local`

Under a test run KickJS reads `.env.test` instead of `.env` — but that is
opt-in, and the generator did not produce the file. A scaffolded app therefore
shipped the exact shape `kick doctor` warns about (a `.env` plus a test runner,
no `.env.test`), and its first test run printed the backfill warning rather
than being isolated. The feature never reached anyone who had not read the docs.

`kick new` now writes a `.env.test` declaring `NODE_ENV=test`, `PORT=0` (ask the
OS for a free port, so a run cannot collide with a dev server on 3000) and
`LOG_LEVEL=silent`. Deliberately not a copy of `.env.example`: a var it omits
goes missing rather than quietly inheriting the developer's value, which is the
entire point of the short-circuit.

`.gitignore` gains `*.local`, covering `.env.local` / `.env.test.local`.
`.env.test` itself stays committed — it is the suite's shared, reviewable
environment.

The generated `vitest.config.ts` is unchanged and deliberately has no `env`
block: vitest's `test.env` sets `process.env` before modules load, which
outranks every file, so pins there would stop `.env.test` taking effect.
