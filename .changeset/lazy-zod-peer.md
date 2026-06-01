---
'@forinda/kickjs': patch
---

Make `zod` a truly optional peer dependency. `src/config/env.ts` previously did a top-level `import { z } from 'zod'` and built `baseEnvSchema` eagerly; since the env module is re-exported from the main entry, `import { anything } from '@forinda/kickjs'` pulled zod into the eager graph and crashed at build/load time for apps that validate env with Valibot/Yup/Standard Schema and never installed zod.

zod is now lazy-loaded only when the Zod env helpers (`baseEnvSchema`, `defineEnv`, `loadEnv`) are actually used, with a clear error if it's missing. `baseEnvSchema` is now a lazy view that doesn't construct (or load zod) until accessed. The non-zod path (`loadEnvFromSchema`) needs no zod at all. `zod` is also marked `optional` in `peerDependenciesMeta`.
