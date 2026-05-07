---
'@forinda/kickjs-cli': minor
---

`kick.config.ts > modules.style: 'define' | 'class'` — opt-out flag for projects that prefer the legacy `class FooModule implements AppModule { ... }` form over the new `defineModule({...})` factory.

```ts
// kick.config.ts
export default defineConfig({
  modules: {
    style: 'class', // pin to legacy form; default is 'define'
  },
})
```

The framework runtime accepts both shapes regardless of this setting — the flag controls codegen output only:

- **`'define'`** (default) — `defineModule({ name, build: () => ({...}) })` factory form, with the orchestrator inserting `TaskModule()` (factory call) into `src/modules/index.ts`.
- **`'class'`** — legacy `class FooModule implements AppModule { ... }`, with the orchestrator inserting bare `TaskModule` (no call) into the modules array.

`kick rm module` matches both `Module` and `Module()` forms, so a project that flips the flag mid-stream can keep adding/removing modules without breakage. Mixing styles in the same project works (loader discriminates `typeof entry === 'function'` at boot).

## What changed

- `ModuleConfig.style?: 'define' | 'class'` added to `kick.config.ts` schema. Unknown values warn + fall back to `'define'`.
- All four pattern generators (DDD, REST, CQRS, minimal) + the `kick g scaffold` template branch on the resolved style.
- `kick g module`'s array-insertion regex emits `Module()` for `'define'` and bare `Module` for `'class'`.
- New tests cover both branches: `kick g module` with no config (default 'define') AND with `kick.config.json: { modules: { style: 'class' } }`.

Suite: 231 → 234 (+3 new style tests). Build + typecheck clean.

## Related — migration command (deferred)

A future `kick migrate modules --experimental` command will rewrite class-form modules to the `defineModule` factory form via TypeScript AST transforms. Out of scope for this PR; the config flag covers the inverse direction (pin to class form) for projects that don't want to migrate.
