---
'@forinda/kickjs': patch
---

An env schema registered with `loadEnvFromSchema()` (Valibot, Yup, a Standard Schema or a function) no longer breaks reads after a dev reload that failed validation: `getEnv()`, `ConfigService` and `@Value()` threw `s.parse is not a function` until the server was restarted. They now validate against that schema again.
