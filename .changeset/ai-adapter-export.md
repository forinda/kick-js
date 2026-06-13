---
'@forinda/kickjs-ai': patch
---

Export `AI_ADAPTER` and the `AiAdapterInstance` type from the package root. Both are documented in the README and the adapter's own JSDoc as the way to inject the adapter (`@Inject(AI_ADAPTER) private ai: AiAdapterInstance`), but were missing from `src/index.ts` so the documented import didn't resolve.
