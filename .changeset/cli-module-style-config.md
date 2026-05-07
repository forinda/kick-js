---
'@forinda/kickjs-cli': minor
---

`modules.style` config flag + `kick codemod modules` migration command + style-drift gate on `kick g module`.

## What's new

### Config flag — `kick.config.ts > modules.style: 'define' | 'class'`

```ts
export default defineConfig({
  modules: {
    style: 'class', // pin to legacy class form; default is 'define'
  },
})
```

The framework runtime accepts both shapes regardless of this setting — `Application` discriminates `typeof entry === 'function'` at boot. The flag controls codegen output only:

| Style                | Module file                                     | Modules registry |
| -------------------- | ----------------------------------------------- | ---------------- |
| `'define'` (default) | `defineModule({ name, build: () => ({...}) })`  | `[TaskModule()]` |
| `'class'`            | `class TaskModule implements AppModule { ... }` | `[TaskModule]`   |

`kick rm module` matches both forms, so flipping the flag mid-project doesn't break un-registration.

### `kick codemod modules` — bidirectional migration

Experimental command that rewrites between the two shapes. **Direction defaults to `modules.style`** from kick.config (or `'define'` when unset), so `kick codemod modules` "just does the right thing" for the project.

```bash
# Default direction = modules.style from kick.config
kick codemod modules --experimental                 # dry-run preview
kick codemod modules --experimental --apply         # write changes

# Override direction explicitly
kick codemod modules --experimental --apply --target class
```

- **Backup before rewrite** — `--apply` writes a timestamped snapshot to `.kickjs/codemod-backups/<iso-stamp>-modules/` before touching any module file. Adopters not tracking with git can revert with `rm -rf <modulesDir> && mv "<backup>" <modulesDir>`. Skip with `--no-backup`.
- **Idempotent** — re-running on already-migrated code is a no-op (returns `'already in target form'` per file).
- **Both module file conventions** — picks up `<modulesDir>/<sub>/<name>.module.ts` (current) AND `<modulesDir>/<sub>/index.ts` (legacy).
- **Conservative** — files with multiple module classes, decorators on the class, or unrecognized method signatures are reported as `skipped` with a reason and left untouched.

### Style-drift gate on `kick g module`

When `style: 'define'` resolves AND the project still has class-form modules, `kick g module` refuses with an actionable error pointing at `kick codemod modules`:

```text
Error: 1 module file(s) still use the legacy `class … implements AppModule` shape.
  Project setting: modules.style: 'define' (default)

  Files needing migration:
    - src/modules/users/user.module.ts

  Pick one:
    1. Migrate everything to defineModule:
       $ kick codemod modules --experimental --apply
    2. Keep the class form — pin it in kick.config.ts:
       // kick.config.ts
       export default defineConfig({ modules: { style: 'class' } })
```

The gate runs only for `'define'`; `'class'` projects accept either shape since defineModule modules pass through Application's class-vs-instance discriminator at boot.

## What changed

- New `packages/cli/src/generators/migrate-modules.ts` — bidirectional class ↔ defineModule rewriter, registry rewriter (`AppModuleClass[]` ↔ `AppModuleEntry[]` + factory-call vs bare-reference), file walker that handles both `*.module.ts` and legacy `<sub>/index.ts` patterns, backup helper.
- New `packages/cli/src/commands/codemod.ts` — `kick codemod` namespace (distinct from `kick db migrate`).
- `kick g module` orchestrator gates on style drift before generating.
- All four pattern generators (DDD/REST/CQRS/minimal) + scaffold template branch on the resolved style.
- `kick rm module` + `kick g scaffold` register-loader emit the matching shape.

## Tests

- 11 new unit tests for the migrator: class→define, define→class, idempotency, register-less modules, multi-class refusal, registry rewrites both directions, `index.ts` detection, backup behavior (creates timestamped dir, dry-run skips, --no-backup skips).
- 3 new integration tests on the gate: default style refuses on legacy modules; style='class' proceeds without checks; style='class' emits class form.

Suite: 231 → 253 (+22). Build + typecheck clean.

## Docs

`docs/guide/generators.md` "Module declaration style" section covers the flag's effect on codegen output. The `kick codemod modules` command surface lives in the command's `--help` output for now.
