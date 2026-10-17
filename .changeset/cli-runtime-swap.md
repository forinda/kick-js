---
'@forinda/kickjs-cli': minor
---

`kick runtime [engine]` shows the HTTP engine an app boots on, or moves it to another: `kick runtime fastify`.

- **Entry file:** `runtime:` calls the new engine's factory, and the imports follow. Leaving Express removes `express.json()` from `middlewares`; arriving on Express adds it back.
- **`kick.config.ts`:** its `runtime` is updated.
- **Packages:** the new engine's are installed, with its multipart parser when a route takes uploads. The old engine's are removed unless `src/` still imports them.

Code that uses the old engine directly, such as `from 'express'` or `ctx.res`, is listed with file and line for review. `--dry-run` prints the plan and changes nothing; `--no-install` leaves packages to you.
