---
'@forinda/kickjs-cli': minor
---

feat: fullstack-aware agent docs + modernized generated guidance

- `kick g agents` / `kick new` accept `fullstack`: the workspace root gets
  CLAUDE.md + `.agents/` with a "Fullstack workspace layout" section (the
  server/web type loop and its do-not-break rules)
- Generated AGENTS.md guidance now teaches return-value handlers +
  `reply()`, declared `{ response: schema }` contracts, the typed client,
  and the `@PostConstruct`/`@PreDestroy` lifecycle pair; the skills
  controller sample returns `reply(201, ...)`
- Dead `ddd`/`cqrs` template labels removed; the ~100-line unused legacy
  CLAUDE template remnant deleted (its comment invited removal)
