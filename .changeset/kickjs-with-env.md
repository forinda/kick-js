---
'@forinda/kickjs': minor
---

`withEnv(overrides, fn)` runs `fn` with some parsed env values replaced. `getEnv`, `ConfigService` and `@Value()` see the replacements, and they're restored afterwards. No `.env` file is read. It's meant for tests.
