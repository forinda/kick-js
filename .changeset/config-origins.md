---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

`app.configOrigins()` reports where each variable the app reads gets its value: `env`, `file` (a `_FILE` secret), `default`, `provided` or `unset`. It covers the env schema and every bound settings section, and returns names only, never values. `originsOf(vars, env)` is the same check for any variable list. DevTools adds it to `/_debug/config` as `origins`.
