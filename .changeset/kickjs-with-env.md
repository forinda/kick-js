---
'@forinda/kickjs': minor
---

`withEnv(overrides, fn)` runs `fn` with some parsed env values laid over the real ones. `getEnv`, `ConfigService` and `@Value()` see the overrides, and the real values come back afterwards. Nested calls layer, and a reload or re-parse inside `fn` keeps the overrides. No `.env` file is read. It's meant for tests.
