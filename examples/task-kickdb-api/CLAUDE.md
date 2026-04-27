# CLAUDE.md — task-kickdb-api

**Read `./AGENTS.md` first.** It is the canonical, multi-agent
reference for this project (Claude, Copilot, Codex, Gemini, etc.) —
project conventions, structure, decorator patterns, env wiring, CLI
generators, every gotcha.

**Then read `./kickjs-skills.md`.** That file is the task-oriented
skill index — short, rigid recipes keyed to triggers ("add-module",
"write-controller-test", "bootstrap-export", "deny-list", …). Use it
as the playbook when executing common KickJS workflows.

This file is a thin Claude-specific layer on top of those two; when
they disagree on anything substantive, treat `AGENTS.md` as
authoritative and flag the discrepancy.

## Why two files

`AGENTS.md` is what every agent reads. `CLAUDE.md` is what
Claude Code automatically loads as project context on each
conversation. Keeping CLAUDE.md slim avoids two files drifting; the
redirect above ensures Claude pulls the canonical content without
us copy-pasting.

## Claude-specific notes

- **Slash commands** — `/help` for Claude Code commands; `/init`
  to refresh project memory if AGENTS.md changes substantially.
- **Feedback** — file issues at <https://github.com/anthropics/claude-code/issues>.
- **Persistent memory** — Claude maintains user/feedback/project/
  reference memories under `.claude/memory/`. If you ask for
  something that contradicts a remembered preference, Claude flags
  it before acting; corrections update memory automatically.
- **Long-running tasks** — `/loop` and `/schedule` for recurring
  or background work. Useful for "wait for the deploy then open a
  cleanup PR" or "every Monday triage the issue board" patterns.

## Quick reference (full version in AGENTS.md)

```bash
pnpm install            # Install dependencies
kick dev                 # Dev server with HMR + typegen
kick build && kick start # Production
pnpm run test           # Vitest
pnpm run typecheck      # tsc --noEmit
pnpm run format         # Prettier
```

## v4 framework reminders

When generating or modifying code in this project, stay aligned with the v4 conventions documented in `AGENTS.md`:

- **Adapters**: `defineAdapter()` factory — never `class implements AppAdapter`.
- **Plugins**: `definePlugin()` factory — never plain function returning `KickPlugin`.
- **DI tokens**: slash-delimited `<scope>/<area>/<key>` (e.g. `'app/users/repository'`). First-party uses the reserved `'kick/'` prefix; this project owns its own scope.
- **Decorators**: `@Controller()` (no path arg — mount prefix comes from `routes().path`).
- **Module entry file** MUST be named `<name>.module.ts` and live under `src/modules/<name>/`. The Vite plugin auto-discovers `*.module.[tj]sx?` for graceful HMR — a misnamed `projects.ts` silently degrades every save into a full restart.
- **Env**: schema lives in `src/config/index.ts`; `import './config'` MUST be the first import in `src/index.ts` (side-effect registers the schema before any `@Value` resolves).
- **Assets**: drop new template files into `src/templates/<namespace>/`; the dev watcher auto-rebuilds the `KickAssets` augmentation + `assets.x.y()` re-walks on next call. No restart, no manual build.
- **Context Contributors** (`defineContextDecorator`) over `@Middleware()` for ctx-population work.
- **Repos under tests**: `Container.create()` for isolation — never `new Container()` or `getInstance().reset()`.
- **Bootstrap export**: `src/index.ts` must end with `export const app = await bootstrap({ ... })`. The Vite plugin and `createTestApp` import the named `app`; without the export, HMR silently degrades to full restarts.
- **Thin entry file**: aggregate `modules`, `middleware`, `plugins`, `adapters` in their own folders (`src/modules/index.ts`, `src/middleware/index.ts`, …) and pass them by name to `bootstrap()` — never inline the lists in `src/index.ts`.
- **Refresh these files**: `kick g agents -f` regenerates `AGENTS.md` + `CLAUDE.md` from the latest CLI templates. Hand-edited content is overwritten — keep customisation in `AGENTS.local.md`.

For everything else (controllers, services, modules, RequestContext API, generators, CLI commands, package additions, env wiring, troubleshooting) → `AGENTS.md`.
