---
'@forinda/kickjs': patch
---

Harden `defineContextDecorator` based on review feedback. Six tightening passes, all backwards-compatible:

1. **Boot-time spec validation.** `defineContextDecorator` now throws `TypeError` immediately if `spec` is missing/non-object, `spec.key` is empty, `spec.resolve` isn't a function, `spec.onError` is provided but not a function, or `spec.dependsOn` is provided but not an array. Adopters get definition-time errors (typically module load) instead of cryptic ContextMeta misses at first request.

2. **Source-location capture.** Every registration now carries `definedAt: string` — a snapshot of `new Error().stack` taken at decorator-construction time. The contributor pipeline threads it into `MissingContributorError`'s message so boot-time errors print `declared at src/contributors/load-project.ts:42:18` instead of forcing adopters to grep for the key string.

3. **Cleaner type story.** Replaced the trailing `as unknown as ContextDecorator<...>` double-cast with overloaded function signatures + `Object.assign` + `Object.freeze`. `decoratorOrFactory` now matches `ContextDecorator`'s call shapes structurally and properties are typed via the assign intersection — no more `as unknown` escape hatch in the factory's return path.

4. **Meaningful `.name` on the returned decorator.** `console.log(LoadTenant)` now prints `[Function: ContextDecorator(tenant)]` instead of `[Function: decoratorOrFactory]`. Stack traces and devtools inspections name the contributor by its key.

5. **Stale-comment sweep.** Dropped the "No runtime behaviour is wired in Phase 1" line — Phase 1 shipped, the topo-sort + runner + HTTP integration are all live. Replaced with a concrete pointer to the new boot-time validation.

6. **Documented unsound `as D` cast.** `Object.freeze({ ...(spec.deps ?? ({} as D)) })` carries an inline comment explaining when the cast is sound (zero-deps default), when it isn't (non-empty `D` with `deps` omitted), and why the runner's loud-fail behaviour is the right tradeoff vs forcing `deps` non-optional in the spec.

`MissingContributorError` gained a fourth optional constructor argument (`dependentDefinedAt?: string`) and a matching readonly field. Existing callers continue to work — the parameter is optional and falls back to the previous message format when absent.

Suite: 366 → 373 tests (+7 — six validation cases + one declared-at assertion). Build + typecheck clean.
