# @forinda/kickjs-lint

Lint rules for KickJS conventions: DI tokens made with `createToken<T>()`, and the reserved `kick/` token prefix.

## Install

```bash
pnpm add -D @forinda/kickjs-lint
```

## Quick example

```bash
kick-lint                    # lints src/
kick-lint --scope src,libs   # other folders
```

| Rule                    | Default | Checks                                                       |
| ----------------------- | ------- | ------------------------------------------------------------ |
| `di-token-symbol`       | `error` | tokens use `createToken<T>()`, not `Symbol(...)`             |
| `token-kick-prefix`     | `error` | first-party tokens start with `kick/` (`--first-party` only) |
| `token-reserved-prefix` | `warn`  | third-party tokens don't use the reserved `kick/` prefix     |

Disable one on a line with `// kick-lint-disable <rule>`. `runLint()` and `formatViolations()` run it from code.

## Documentation

[DI tokens](https://kickjs.app/guide/dependency-injection#tokens)

## License

MIT
