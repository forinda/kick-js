---
'@forinda/kickjs': patch
---

Export the concrete types `ContextDecorator` resolves to, so generated contributors typecheck

`ContextDecorator` was exported, but the two interfaces it resolves to —
`ContextDecoratorWithDefaults` and `ContextDecoratorRequiringParams` — were not,
nor were the `MissingParamKeys` / `CallSiteParams` helpers in their public
positions.

`defineContextDecorator()` infers one of those concrete interfaces, so the
ordinary consumer pattern

```ts
export const Tenant = defineContextDecorator({ ... })
```

made TypeScript emit a declaration for a type it had no import path to:

```text
TS4023: Exported variable 'Tenant' has or is using name
'ContextDecoratorWithDefaults' from external module … but cannot be named
```

Every file `kick g contributor` produces is exactly that shape, so all of them
failed `tsc --noEmit` in a scaffolded app while the framework's own build stayed
green — same-project types are always nameable, which is why this only appeared
downstream.

Type-only change; no runtime behaviour is affected.
