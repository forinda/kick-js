---
'@forinda/kickjs-db': minor
'@forinda/kickjs-cli': patch
---

`kick db seed [names...]` runs the seed files in `db/seeds` (`seedsDir` in the `db` config) in name order, or only the ones named. Each file default-exports an async function and imports what it needs — usually the app's own client — and nothing records that it ran, so seeds are written to be re-run (`db.upsert()` / `db.findOrCreate()`). A failing seed stops the run with `Seed <file> failed: …` and exit code 1. Also exported as `runSeeds()` / `listSeeds()`.

Schema files, seed files and `kick db check` now load through jiti, like `kick.config.ts`: a schema split across files with extensionless relative imports used to fail under Node's built-in TypeScript loading.
