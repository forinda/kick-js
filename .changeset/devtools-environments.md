---
'@forinda/kickjs-devtools': minor
---

Named environments in the API runner: `dev` / `stage` / `prod` (or `anonymous` / `admin`), each with its own default headers, variables and param mappings, edited in a sheet of their own. One is active and a route can be pinned to another. A variable named like a path or query param fills it when it's left empty, and a mapping covers names that differ (`:tenantId` ← `orgId`). "Save to variable" writes to the environment the route uses. The previous single environment's headers and variables carry over as `dev`.
