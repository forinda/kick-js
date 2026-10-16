---
'@forinda/kickjs-devtools': minor
---

`/_debug/config` (`exposeConfig: true`) no longer lists every variable in `process.env`. It shows the values of variables matching `configPrefixes`, lists the app's other declared variables (env schema and settings sections) as `[REDACTED]`, and leaves everything else out — the names of unrelated environment variables no longer leak.

Migration: a variable you relied on seeing as `[REDACTED]` must now be declared in the env schema or a settings section, or matched by `configPrefixes` (which shows its value).
