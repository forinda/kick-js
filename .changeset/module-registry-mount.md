---
'@forinda/kickjs': minor
---

`ModuleRegistry` + `setup(registry)` callback — imperative module registration alongside the static `modules: [...]` array. Lays the foundation for `.use(module)` (non-HTTP modules) without committing to its semantics yet.

## What's new

```ts
import { bootstrap } from '@forinda/kickjs'

await bootstrap({
  modules: [HelloModule()], // static — always mounted

  setup(registry) {
    if (process.env.ENABLE_ADMIN === 'true') {
      registry.mount(AdminModule())
    }
    for (const tenant of TENANTS) {
      registry.mount(TenantModule.scoped(tenant.id, tenant))
    }
  },
})
```

- New `ModuleRegistry` type with one method: `.mount(module: AppModuleEntry)`. Internal collector `MutableModuleRegistry` is what bootstrap passes around; adopters interact through the interface.
- New `ApplicationOptions.setup?(registry: ModuleRegistry)` callback on `bootstrap()`.
- New `KickPlugin.setup?(registry: ModuleRegistry)` lifecycle hook on plugins. Runs after `plugin.modules?()` so plugins can mix static + dynamic registration in the same plugin.

Order across the whole pipeline (preserved across bootstrap):

1. plugin static modules (`plugin.modules?()`)
2. plugin `setup()` calls (in plugin dependsOn-sorted order)
3. user static modules (`options.modules`)
4. user `setup()` callback

The static `modules: [...]` array keeps working unchanged — `setup` is purely additive.

## Why only `.mount(module)` (not `.use`)

`.mount` covers the HTTP-feature path that drives most adopter use today. A future `.use(module)` is planned for non-HTTP modules (queues, cron, workers, DI-only seeds) — adding it later won't be a breaking change because `ModuleRegistry` is the adopter-facing type and `mount()` is the only stable method on it now. Existing non-HTTP modules continue returning `null` from `routes()` and using `.mount()` (or staying in the static array) until `.use` lands.

## Soft deprecation

`AppModuleClass` now carries a `@deprecated` JSDoc tag pointing at `defineModule({...})` + `AppModuleEntry`. The class form keeps working through v5 — no runtime warnings, no breaking changes — the annotation is a soft "prefer the factory form" hint shown in IDE tooltips.

## Tests

- `MutableModuleRegistry`: starts-empty, mount-appends-in-order, accepts both class and instance forms, referentially-stable entries array, surface only exposes `mount`.
- Application integration: bootstrap setup callback runs and threads mounts through the loader; plugin.setup runs before bootstrap.setup; missing setup is backwards compatible; plugin setup threads captured config.

Suite: 375 → 385 tests (+10). Build + typecheck clean.

## Docs

`docs/guide/modules.md` gains a "Conditional registration — `setup(registry)`" section. `docs/guide/plugins.md` adds `setup()` to the lifecycle table with a `modules() vs setup()` subsection covering when to use each.
