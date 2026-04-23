# @forinda/kickjs-lint

Lint rules for KickJS conventions — DI tokens, plugin/adapter naming, and other framework patterns.

## Install

```bash
pnpm add -D @forinda/kickjs-lint
```

## CLI

```bash
# adopter project — lints `src/`, warns on third-party kick/ squatting
kick-lint

# framework / first-party packages — lints `packages/`, errors on missing kick/ prefix
kick-lint --first-party

# custom scope
kick-lint --scope src,libs
```

## Programmatic

```ts
import { runLint, formatViolations } from '@forinda/kickjs-lint'

const result = await runLint({ cwd: process.cwd(), firstParty: false })
if (result.violations.length > 0) console.error(formatViolations(result.violations))
```

## Rules

| Rule                        | Default  | Description                                                                        |
| --------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `di-token-symbol`           | `error`  | DI tokens must use `createToken<T>()` instead of `Symbol(...)` in token files       |
| `token-kick-prefix`         | `error`  | First-party tokens must start with the reserved `kick/` prefix                     |
| `token-reserved-prefix`     | `warn`   | Third-party tokens must not squat the reserved `kick/` prefix                       |

Inline-disable a rule on a single line:

```ts
export const FOO = Symbol('Legacy') // kick-lint-disable di-token-symbol
```

## Why

See [architecture.md §22](https://github.com/forinda/kick-js/blob/main/architecture.md#22-di-token-convention--symbol-to-string-migration) for the convention rationale and the [v3→v4 migration guide](https://forinda.github.io/kick-js/guide/migration-v3-to-v4) for what changed.
