---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

Conditional adapters. An adapter's `when` decides at startup whether it runs: helpers `onEnv('NAME', value?)`, `onPackage('name')` and `allOf(...)`, or any `() => boolean | string`. An adapter left out runs no hooks and adds no middleware, and adapters that `dependsOn` it are left out too. `app.getConditionReport()` lists each outcome with its reason, and DevTools serves it at `/_debug/conditions`.
