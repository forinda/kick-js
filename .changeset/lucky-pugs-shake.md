---
'@forinda/kickjs-cli': patch
---

Scaffolded project docs: fix guidance that contradicts the code beside it.

`project-docs.ts` writes `AGENTS.md` / `CLAUDE.md` into every new project, so a
stale line there ships to every adopter and is read by their agents as fact.

- **`bootstrap({ middleware })` in eight places.** The option is `middlewares`
  and the singular alias is deleted, so the documented call silently drops every
  global middleware — while `project-app.ts`, written in the same run, correctly
  emits `middlewares:`. The generated docs contradicted the generated code.
- **`kick add auth`** was the first command under "Adding Features". That entry
  is gone from the catalog; the command now fails.
- **`container.resolve(InMemoryTodoRepository)`** in the module example. No such
  class is generated — the repository is a `createTodoRepository()` factory, and
  `module-index.ts` emits `registerFactory(TODO_REPO, () => createTodoRepository())`.
- **`<name>.repository.ts # Data access (@Repository)`** in the folder map. The
  generated file has no decorator and no class.
