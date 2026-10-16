---
'@forinda/kickjs-cli': patch
---

`kick add queue` / `kick new --packages queue` declare `REDIS_HOST`, `REDIS_PORT` and `REDIS_PASSWORD` in the env schema (Zod, Valibot or Yup — whichever `src/config/index.ts` uses) and read them with `getEnv` from a new `src/adapters/queue.ts`, instead of writing `process.env.REDIS_*` into `src/index.ts` and values into `.env`. The password has no default. `kick add storage` writes `src/adapters/storage.ts` (was `src/storage.ts`) and reports files it creates as `Created`, not `Updated`.
