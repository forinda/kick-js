---
'@forinda/kickjs': patch
---

`ApplicationOptions.runtime` now accepts any `HttpRuntime`, so `bootstrap({ runtime: fastifyRuntime() })` typechecks without a cast. It was previously typed `HttpRuntime<Express>`, which forced a `as never` / `as any` when passing a non-Express runtime. The engine-native escape hatches (`getRuntimeApp()`, `AdapterContext.app`) continue to follow the active runtime via the `ActiveRuntime` registry (Express by default). Behavior is unchanged.
