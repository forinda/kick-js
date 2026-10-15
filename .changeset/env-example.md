---
'@forinda/kickjs-cli': minor
'@forinda/kickjs': minor
---

`kick env example` writes `.env.example` from the env schema and every declared settings section. Required variables are written bare; optional ones are commented, with their default and description. `--check` exits 1 when the file is missing or stale, for CI. The command loads the app through its Vite config with `bootstrap()` captured and the env loaders in describe mode, so it needs no environment. In kickjs, `app.describeConfig()` lists the same variables without reading or validating the environment, and settings sections gain `describe()`.
