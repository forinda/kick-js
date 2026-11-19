---
'@forinda/kickjs': patch
---

A dev reload whose `.env` fails validation keeps the last good values readable, as a failed rebuild keeps the previous app. Before, `@Value()` read `undefined` until the next good reload, and with an env schema registered through `loadEnvFromSchema()` (Valibot, Yup, a Standard Schema, a function, or a `fromZod()` wrapper), `getEnv()` and `ConfigService` threw `s.parse is not a function` until the server restarted. That schema is now validated through `loadEnvFromSchema()` wherever the env is read again.
