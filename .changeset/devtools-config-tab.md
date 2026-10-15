---
'@forinda/kickjs-devtools': minor
---

A **Config** tab shows where each variable the app declares gets its value: the environment, a `<NAME>_FILE`, the schema's default, `provide()`, or unset. The env schema comes first, then each settings section. Its data comes from a new `/_debug/config/origins` endpoint. That endpoint serves names only, never values, so it's available without `exposeConfig`.
