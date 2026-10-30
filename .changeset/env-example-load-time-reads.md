---
'@forinda/kickjs': patch
---

`kick env example` no longer fails on an entry file that passes env values on as it loads. While describing, `getEnv()` and `loadEnv()` returned nothing, so `session({ secret: getEnv('SESSION_SECRET') })`, which every app from the inertia template has, threw "`secret` must be a non-empty string" and the command stopped. They now return the value that's set or the schema's default, with a placeholder for a required variable that has neither. Validation is still skipped.
