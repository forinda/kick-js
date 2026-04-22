# AGENTS.md — KickJS

> **The canonical agent reference for this monorepo lives in [`CLAUDE.md`](./CLAUDE.md).**
> Read it first. Treat anything in this file as authoritative when the two
> disagree.

This file exists so other agent tools (Codex, Gemini, Copilot CLI, etc.) can
find their bearings even if their convention is to look here. It intentionally
stays minimal — repo conventions, commands, package layout, code style,
release flow, decorators, request lifecycle, and patterns all live in
`CLAUDE.md`.

## Quick orientation

| What                                             | Where                                                    |
| ------------------------------------------------ | -------------------------------------------------------- |
| Repo conventions, commands, patterns             | `CLAUDE.md`                                              |
| All published packages                           | `packages/<name>/` (18 of them, all `@forinda/kickjs-*`) |
| The single source of truth for core/http changes | `packages/kickjs/`                                       |
| Mirror packages — do **not** edit directly       | `packages/core/`, `packages/http/`                       |
| Example apps (private)                           | `examples/<name>/`                                       |
| Docs site (VitePress)                            | `docs/`                                                  |
| Architecture notes                               | `architecture.md`                                        |
| CLI / generators / scaffolding                   | `packages/cli/`                                          |

## Three non-negotiables

1. **Source of truth is `packages/kickjs/`.** `packages/core/` and
   `packages/http/` are frozen mirrors — never edit them directly. All
   core/http changes go to `packages/kickjs/`.
2. **Always use `pnpm`.** Never npm, never yarn. Pre-commit hook will reject
   mixed installs.
3. **Pre-commit hook runs `build → test → format:check`** via husky. Don't
   bypass with `--no-verify` unless you know what you're doing.

## Bootstrapping

```bash
pnpm install
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm format             # Fix formatting
pnpm docs:dev           # Dev docs server
```

## Where to go next

- `CLAUDE.md` — full repo guide (package layout, code style, release flow,
  decorators, lifecycle, common pitfalls, env wiring)
- `architecture.md` — research notes + design records (e.g. §20 Context
  Contributor pipeline)
- [KickJS docs](https://forinda.github.io/kick-js/) — public framework reference
- [Decorators guide](https://forinda.github.io/kick-js/guide/decorators.html)
- [Context Decorators](https://forinda.github.io/kick-js/guide/context-decorators.html)
- [Plugin system](https://forinda.github.io/kick-js/guide/plugins.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
