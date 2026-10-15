# @forinda/kickjs-lint

Lint rules for KickJS conventions — currently the DI token rules: declare tokens with `createToken<T>()` rather than `Symbol(...)`, and keep the `kick/` token prefix for the framework's own packages. Ships a `kick-lint` binary and a programmatic API.

## Install

```bash
pnpm add -D @forinda/kickjs-lint
```

No dependencies or peers.

## Entry points

| Import path                  | Exports                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-lint`       | `runLint`, `formatViolations`, `TOKEN_FILE_NAMES`, `defaultRules`, `diTokenSymbol`, `tokenKickPrefix`, `tokenReservedPrefix`, and the types `LintOptions`, `LintResult`, `Rule`, `Violation`, `LintContext` |
| `@forinda/kickjs-lint/rules` | `rules`, `diTokenSymbol`, `tokenKickPrefix`, `tokenReservedPrefix`, and the types `Rule`, `Violation`, `LintContext`                                                                                        |
| `kick-lint` (bin)            | Command-line runner                                                                                                                                                                                         |

## kick-lint

```bash
kick-lint                       # lint ./src
kick-lint --scope src,libs      # lint other subdirectories
kick-lint --cwd ../other-app    # run against another directory
```

| Flag             | Description                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `--first-party`  | Framework ruleset (`token-kick-prefix` on, `token-reserved-prefix` off); default scope becomes `packages`. |
| `--scope <dirs>` | Comma-separated subdirectories to walk. Default `src`.                                                     |
| `--cwd <path>`   | Working directory. Default `process.cwd()`.                                                                |
| `--help`, `-h`   | Print usage.                                                                                               |

Exit code `1` when any `error` violation is found, `0` otherwise (warnings alone pass), `2` for a bad argument.

## Rules

Only files whose name is in `TOKEN_FILE_NAMES` are checked: `types.ts`, `tokens.ts`, `constants.ts`, `service.ts`, `adapter.ts`, `database.ts`, `interfaces.ts`, `client.ts`. The walker skips `node_modules`, `dist`, `__tests__`, `.kickjs`, `public`, `.vitepress`, `.turbo`, `.wireit` and `coverage`.

| Id                      | Severity | Applies to       | Flags                                                                                         |
| ----------------------- | -------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `di-token-symbol`       | error    | all code         | `export const X = Symbol(...)`. Silence one line with `// kick-lint-disable di-token-symbol`. |
| `token-kick-prefix`     | error    | first-party only | `createToken('…')` literals not starting with `kick/` (`kickjs.` / `kickjs/` are allowed).    |
| `token-reserved-prefix` | warn     | non-first-party  | `createToken('kick/…')` — the `kick/` prefix is reserved; use your own scope (`'mycorp/…'`).  |

```ts
// tokens.ts
export const USER_REPO = Symbol('UserRepo') // di-token-symbol (error)
export const ORDER_REPO = createToken<OrderRepo>('kick/orders/repo') // token-reserved-prefix (warn)
export const TASK_REPO = createToken<TaskRepo>('app/tasks/repo') // ok
```

## runLint

Walk `cwd`, apply every rule to each token-bearing file, and return the violations.

```typescript
function runLint(opts: LintOptions): Promise<LintResult>

interface LintResult {
  violations: Violation[]
  filesScanned: number
}
```

### LintOptions

| Field        | Type                  | Default            | Description                                                                |
| ------------ | --------------------- | ------------------ | -------------------------------------------------------------------------- |
| `cwd`        | `string`              | — (required)       | Root directory.                                                            |
| `firstParty` | `boolean`             | `false`            | Lint as a first-party `@forinda/kickjs-*` package.                         |
| `scope`      | `readonly string[]`   | `['packages']`     | Subdirectories of `cwd` to walk. Pass `['src']` for an app (the CLI does). |
| `rules`      | `readonly Rule[]`     | `defaultRules`     | Rule set to apply.                                                         |
| `filenames`  | `ReadonlySet<string>` | `TOKEN_FILE_NAMES` | File names to lint.                                                        |

```ts
import { runLint, formatViolations } from '@forinda/kickjs-lint'

const { violations } = await runLint({ cwd: process.cwd(), scope: ['src'] })
if (violations.length) console.error(formatViolations(violations))
```

## formatViolations

Format violations for a terminal: one block per violation plus a summary line. Returns `''` for an empty list.

```typescript
function formatViolations(violations: readonly Violation[]): string
```

## Rule types

```typescript
interface Rule {
  id: string
  description: string
  defaultSeverity: 'error' | 'warn'
  check(ctx: LintContext): Violation[]
}

interface LintContext {
  source: string
  file: string // path relative to cwd
  firstParty: boolean
}

interface Violation {
  ruleId: string
  severity: 'error' | 'warn'
  file: string
  line: number // 1-based
  message: string
  suggestion?: string
}
```

`defaultRules` (`rules` from `./rules`) is `[diTokenSymbol, tokenKickPrefix, tokenReservedPrefix]`. Add your own rule by passing `rules: [...defaultRules, myRule]`.

## See also

- [Dependency injection](../guide/dependency-injection.md) — `createToken`
- [Migration v3 → v4](../guide/migration-v3-to-v4.md) — why tokens moved off `Symbol`
