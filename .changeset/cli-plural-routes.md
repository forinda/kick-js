---
'@forinda/kickjs-cli': minor
---

`kick g module` and `kick g scaffold` mount the module at the plural of its name again: `kick g module task` writes `src/modules/task/` with `TaskController`, mounted at `/tasks`; `user-profile` mounts at `/user-profiles`; uncountables stay (`auth` → `/auth`). Folder, file and class names still use the name as typed, and `--pluralize` / `modules.pluralize: true` still pluralizes those too.

New `modules.pluralizeRoutes` (default `true`) and `--pluralize-routes` / `--no-pluralize-routes` choose the route form.

**Migration:** modules generated from here on mount at the plural. Existing modules keep the path written in their `*.module.ts`. To keep generating singular routes, set `modules: { pluralizeRoutes: false }` in `kick.config.ts`.
