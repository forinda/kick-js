---
'@forinda/kickjs-cli': minor
---

typegen: resolve decorated classes at any module depth + `kick typegen --fix`

Decorated classes (`@Controller`, `@Service`, …) only register at runtime if a
module's `import.meta.glob([...], { eager: true })` imports their file. When you
reorganise a module into sub-folders (e.g. moving controllers into
`controllers/`), a shallow glob stops reaching them — routes silently vanish and
DI tokens resolve `undefined`. Typegen already detected this; now it helps fix it:

- **Actionable warning** — orphaned classes are grouped by their owning module
  file, with the exact recursive glob to add (`./**/*.controller.ts`) and a
  `kick typegen --fix` hint.
- **`kick typegen --fix`** — patches each module's `import.meta.glob(...)` call in
  place (array or bare-string form), adding the missing recursive patterns.
  Idempotent; skips patterns already present.
- **Scaffold templates** now emit recursive globs that include controllers, so
  newly-generated modules don't orphan when reorganised.
