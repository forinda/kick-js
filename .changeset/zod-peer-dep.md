---
'@forinda/kickjs': minor
'@forinda/kickjs-swagger': patch
---

deps: move `zod` to `peerDependencies` in `@forinda/kickjs`; align `@forinda/kickjs-swagger` peer range

**Why:** Pinning `zod` as a regular `dependency` of `@forinda/kickjs` meant adopters got whichever zod version kickjs happened to ship with — and couldn't upgrade to a newer zod release until kickjs cut a new version. Multiple zod copies in `node_modules` were also possible, with the well-known "schema built with copy A doesn't pass through `parse()` dispatched from copy B" failure mode on minor mismatches.

Both packages now declare `zod: ^4.0.0` as a **peer dependency**, so the adopter picks the version. Within zod 4.x they can freely upgrade; for a future zod 5 they wait for kickjs to declare support (zod has historically had breaking majors).

**`@forinda/kickjs`** — `zod` moved from `dependencies` to `peerDependencies` (required, not optional — `baseEnvSchema = z.object(...)` runs at module load when `@forinda/kickjs` is imported, so the framework can't load without zod present).

**`@forinda/kickjs-swagger`** — peer range tightened from `>=4.0.0` to `^4.0.0` for consistency with kickjs. Stays optional: `schema-parser.ts` duck-types Zod schemas (no `import 'zod'` in `src/`) so adopters using non-Zod parsers (Joi, Valibot, Yup, ArkType) don't need zod at all.

**Upgrade impact:**

- Projects scaffolded with `kick new` already pin `zod: ^4.4.3` — no action required.
- Projects on `npm install`, `yarn` (non-strict), or `pnpm install` without `--strict-peer-dependencies` will see a "missing peer dependency" warning if they don't have zod. Fix: `pnpm add zod` (or your package manager's equivalent).
- Projects using pnpm with `strict-peer-dependencies=true` or npm 7+ with `--legacy-peer-deps=false` will hard-fail until they add zod themselves.

No runtime API change. `import { z, baseEnvSchema, defineEnv, loadEnv, ... } from '@forinda/kickjs'` continues to work identically once zod is installed.
