---
'@forinda/kickjs': patch
---

Fix: `VITEST` no longer loses to a non-test `NODE_ENV` when selecting env files

Two predicates disagreed about what a test run is. File selection used
`NODE_ENV ?? (VITEST ? 'test' : 'development')`, so an explicitly-set
`NODE_ENV=development` always won — but the backfill warning was gated on a
separate check that counts `VITEST` on its own.

The result was the worst of both: a vitest run with `NODE_ENV=development`
exported (a shell profile, a CI image) skipped the `.env.test` sitting right
there, loaded the developer's `.env`, and then printed a warning telling the
user to create the very file it had just ignored. The alarm without the
protection.

`VITEST` now outranks a non-test `NODE_ENV` for file selection, so the two
agree. Only affects runs that set `NODE_ENV` to something other than `test`
while under a test runner; everything else resolves exactly as before. To point
a suite at another mode's files deliberately, name them with `KICKJS_ENV_FILE`.
