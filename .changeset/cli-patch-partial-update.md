---
'@forinda/kickjs-cli': minor
---

Generated controllers (`kick g module`, `kick g scaffold`, `kick g controller`, the minimal pattern) serve the update route as `PATCH /:id` instead of `PUT /:id`. The update schema has every field optional, so the route is a partial update, which is what PATCH means. The handler is still named `update`.

**Migration:** existing modules are unchanged. A client written against a newly generated module calls `PATCH` (`client.patch('/api/v1/tasks/:id', …)`) for updates.
