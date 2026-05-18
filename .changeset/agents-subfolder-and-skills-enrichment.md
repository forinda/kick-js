---
'@forinda/kickjs-cli': minor
---

feat(cli): `.agents/` subfolder layout + standard SKILL.md format + doc-driven skill enrichment

`kick g agents` now emits the agent-context files into a structured `.agents/` subfolder, with skills following the standard Claude Code / Copilot CLI per-skill `SKILL.md` format (one directory per skill with YAML frontmatter), and every skill body has been rewritten from the official guide pages to reflect concrete patterns + red flags + nuances.

**New layout**

```
CLAUDE.md                 # at root — Claude Code auto-loads from here (thin pointer to .agents/)
.agents/
├── AGENTS.md             # canonical multi-agent reference
├── GEMINI.md             # Gemini CLI specific notes (NEW)
├── COPILOT.md            # Copilot CLI specific notes (NEW)
└── skills/
    ├── add-module/SKILL.md
    ├── add-adapter/SKILL.md
    ├── add-plugin/SKILL.md                       # NEW
    ├── write-controller-test/SKILL.md
    ├── env-wiring-check/SKILL.md
    ├── bootstrap-export/SKILL.md
    ├── thin-entry-file/SKILL.md
    ├── context-contributor/SKILL.md
    ├── query-parsing-list-endpoint/SKILL.md      # NEW
    ├── use-asset-manager/SKILL.md                # NEW
    ├── cli-commands-cheatsheet/SKILL.md          # NEW
    ├── refresh-agent-docs/SKILL.md
    └── deny-list/SKILL.md
```

Each `SKILL.md` opens with YAML frontmatter (`name: kickjs-<slug>`, `description: <when to use>`) so agents that auto-discover skills (Claude Code, Copilot CLI plugins, Gemini's `activate_skill`) pick each up without an external index file.

**New API surface**

- `defineGemini` / `defineCopilot` template helpers exported from `@forinda/kickjs-cli` (alongside the existing `generateAgents` / `generateClaude`).
- `generateKickJsSkillFiles(name, template, pm): KickJsSkillFile[]` replaces the legacy single-file `generateKickJsSkills` (kept as `@deprecated` for one minor for back-compat).
- New `--only gemini` and `--only copilot` flags on `kick g agents` for targeted refreshes.
- New `findProjectRoot()` export — implicit, since `agent-docs.ts` uses it for cwd resolution, but the rest of the CLI was already using it.

**Migration behaviour**

When `kick g agents` runs against an existing project, root-level `AGENTS.md` / `kickjs-skills.md` are **left untouched**. The new layout emits alongside — adopters delete the legacy files manually when they're ready. `CLAUDE.md` at the root is rewritten to point at `.agents/` paths.

**Enriched skill content**

Each of the 13 skill bodies has been rewritten to faithfully reflect the official docs:

- **`add-module`** — `defineModule` factory, `import.meta.glob` requirement, versioned route arrays, conditional `setup(registry)` mounting, factory-invocation footgun.
- **`add-adapter`** — `defineAdapter` factory, lifecycle hook decision tree (`beforeMount` / `beforeStart` / `afterStart` / `shutdown`), middleware phases, `.scoped` / `.async` patterns, `dependsOn` topo-sort, when to promote to a plugin.
- **`add-plugin`** _(NEW)_ — `definePlugin` factory, inline-literal pattern for one-off DI bindings, execution order, multi-instance, when plugin > adapter.
- **`write-controller-test`** — `Container.reset()` in `beforeEach`, typed `Ctx<KickRoutes...>`, `Scope.REQUEST` × singleton incompatibility.
- **`env-wiring-check`** — side-effect import requirement, `reloadEnv` vs `resetEnvCache`, sticky cache, `@Value` `process.env` fallback that masks bugs.
- **`bootstrap-export`** — Vite HMR + `createTestApp` consequences of missing `export const app`.
- **`thin-entry-file`** — category-folder split, three middleware signatures (raw Express / `(ctx, next)` / adapter Express again), inline-plugin DI binding pattern.
- **`context-contributor`** — `defineHttpContextDecorator` + DI `deps` + `dependsOn` topo-sort + ALS three-instance model + error matrix + augmentation completeness.
- **`query-parsing-list-endpoint`** _(NEW)_ — `ctx.qs` + `ctx.paginate`, operator format, Drizzle column-ref config, allow-list security default.
- **`use-asset-manager`** _(NEW)_ — `assets.<ns>.<key>()` typed Proxy, `@Asset` decorator, test fixture swap via `KICK_ASSETS_ROOT` + `clearAssetCache()`.
- **`cli-commands-cheatsheet`** _(NEW)_ — top commands, useful flag combos, lesser-known high-value commands, common red flags.
- **`refresh-agent-docs`** — updated for the `.agents/` layout.
- **`deny-list`** — grew to enumerate every cross-skill anti-pattern in one place.

**Tests** — `__tests__/agent-docs-layout.test.ts` covers the full layout: CLAUDE.md at root, all `.agents/` files emitted, ≥ 13 SKILL.md files with valid frontmatter, existing root-level files untouched, CLAUDE.md pointers correct, package-manager interpolation works.
