---
'@forinda/kickjs': minor
---

Boot-time duplicate-route guard (KICK006). Two handlers claiming the same HTTP verb + mounted path now fail `Application.setup()` / `createWebApp()` with a structured `KickError` instead of silently losing the dispatch race — previously the engine served one handler while `kick typegen` and the typed client could describe the other. Param names are ignored when comparing (`GET /tasks/:id` and `GET /tasks/:taskId` collide). Same path under a different verb or module `version` is unaffected.

Heads-up: an app that today registers the same route twice (a latent bug — only one handler ever ran) will now fail at boot with a KICK006 pointing at both registrations.
