---
'@forinda/kickjs-swagger': minor
---

Predictable schema names in `components/schemas`. The default is now `<Class><Method><Part>` — `TaskControllerCreateBody`, `TaskControllerCreateResponse`, `TaskControllerCreateResponse201` — instead of `createBody` / `createResponse201`, which two controllers could share. A name you give comes first (`@ApiResponse({ name })` as is; the route's `name` as a prefix: `CreateTaskBody`, `CreateTaskResponse` — a named body used to take the bare name), then the schema's own `title`. A name already holding a different schema is reported and falls back to the `<Class><Method><Part>` name, instead of becoming `Name_2`.
