# Using Vite+

[Vite+](https://viteplus.dev) (`vite-plus`, the `vp` command) bundles Vite, Vitest, Oxlint and Oxfmt behind one CLI. A KickJS app runs under it unchanged:

- `vp dev` boots the server — decorators and DI metadata still compile through swc, and an Inertia app gets SSR, styles and Fast Refresh.
- `vp test` runs the suite, and `vp build` builds the server to the same `dist/index.js` as `kick build`.
- `kick dev`, `kick build`, `kick start`, `kick typegen` and `kick g` keep working after the migration.

## Migrating

<PmCommand add="vite-plus" dev />

Commit first — `vp migrate` has no dry run:

<PmCommand exec="vp migrate" />

`vp migrate` rewrites the project:

- removes the `oxlint`, `oxfmt` and `vitest` devDependencies;
- points `vite` at a catalog alias of `@voidzero-dev/vite-plus-core`;
- rewrites imports to `vite-plus` and `vite-plus/test` (and the `test` script to `vp test run`);
- reformats the files it touches in its own style — double quotes and semicolons.

The last point is undone by the `fmt` block below: add it, then run `vp fmt`.

## Formatting and linting: `vite.config.ts`

`vp fmt`, `vp lint` and `vp check` read the `fmt` and `lint` blocks in `vite.config.ts`, not `.oxfmtrc.json` or `.oxlintrc.json`. Copy the scaffold's formatter settings across:

```ts
export default defineConfig({
  // Same options as .oxfmtrc.json.
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    tabWidth: 2,
    // .agents/ holds the generated agent docs.
    ignorePatterns: ['**/dist/', '**/.kickjs/', '**/node_modules/', '.agents/**'],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
  },
  // ...the rest of the scaffolded config
})
```

Keep `.oxfmtrc.json` too: `kick g` reads it to format the files it generates, so the two must agree.

With `typeAware` and `typeCheck` on, `vp check` also type-checks — including the root config files (`vite.config.ts`, `kick.config.ts`), which a scaffold's `tsconfig.json` includes as well.

## `kick.config.ts` commands

The scaffold's `lint` / `format` / `ci:check` commands call `oxlint` and `oxfmt`, which `vp migrate` uninstalls. Point them at `vp`:

```ts
commands: [
  {
    name: 'test',
    description: 'Run tests with Vitest',
    steps: 'vp test run --passWithNoTests',
  },
  {
    name: 'lint',
    description: 'Lint with Vite+ (Oxlint)',
    steps: 'vp lint src/',
  },
  {
    name: 'format',
    description: 'Format code with Vite+ (Oxfmt)',
    steps: 'vp fmt src/',
  },
  {
    name: 'format:check',
    description: 'Check formatting without writing',
    steps: 'vp fmt --check src/',
  },
  {
    name: 'ci:check',
    description: 'Run typecheck + lint + format check',
    steps: ['kick typecheck', 'vp check'],
    aliases: ['verify'],
  },
],
```

## Keep `kick dev` as the dev script

`vp dev` does not run `kick typegen`; `kick dev` regenerates `.kickjs/types` on every save. Leave `"dev": "kick dev"` in `package.json`, or run the watcher next to `vp dev`:

```bash
kick typegen --watch
```

## Generated tests

`kick g module` and `kick g test` write tests that import from `vitest` — or from `vite-plus/test` when the project depends on `vite-plus` and not `vitest`, which is what `vp migrate` leaves. Nothing to configure.
