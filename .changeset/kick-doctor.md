---
'@forinda/kickjs-cli': minor
---

feat(cli): `kick doctor` — pre-flight checks for dev environment

New CLI command that catches common "doesn't work on my machine" misconfigs before they bite. Sibling to `kick check --deploy` (which scans for production-readiness); doctor is the dev-setup counterpart.

```bash
kick doctor
```

Sample output:

```text
KickJS Doctor

✔  Node version  (v22.7.0)
✔  @forinda/kickjs installed  (^5.12.0)
✔  express installed  (^5.1.0)
✔  reflect-metadata installed  (^0.2.2)
✔  tsconfig: experimentalDecorators
✔  tsconfig: emitDecoratorMetadata
✔  env wiring
✔  typegen freshness  (2m ago)

8 passed, 0 warnings, 0 errors — your environment looks good
```

Exit code is `0` on pass-or-warn, `1` on any error.

**Built-in checks (this first pass):**

| Check                              | Severity     | Detects                                                                                                                                                                                   |
| ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node version                       | error        | Node < 20                                                                                                                                                                                 |
| `@forinda/kickjs` installed        | error        | Wrong directory / fresh repo                                                                                                                                                              |
| `express` installed                | error        | Required peer dep missing                                                                                                                                                                 |
| `reflect-metadata` installed       | error        | Decorator polyfill missing                                                                                                                                                                |
| tsconfig: `experimentalDecorators` | error        | Decorators won't compile                                                                                                                                                                  |
| tsconfig: `emitDecoratorMetadata`  | error        | DI container can't read constructor types                                                                                                                                                 |
| env wiring                         | error / warn | env-init file (`src/env.ts`, `src/env/index.ts`, `src/config/env.ts`, `src/config/index.ts`) calls `loadEnv(...)` but the app entry doesn't import it — or imports it AFTER `bootstrap()` |
| typegen freshness                  | warn         | `.kickjs/types/` last touched > 60 min ago                                                                                                                                                |

The env-wiring check handles common file-location variations and accepts both relative (`'./env'`, `'./config/env'`) and `@/`-aliased (`'@/env'`, `'@/config'`) imports. Detects the canonical "ConfigService.get() returns undefined while @Value() works" footgun.

**No ORM-specific checks in core.** The framework stays stack-agnostic — Prisma / Drizzle / Mongoose checks belong in adopter config (or in adapter packages that ship doctor extensions).

**Extensibility — `defineDoctorExtension`:**

```ts
// doctor-checks/prisma.ts (publishable as a package, or workspace-shared)
import { defineDoctorExtension } from '@forinda/kickjs-cli'

export const prismaDoctor = defineDoctorExtension({
  checks: [
    (ctx) => {
      // adopter-defined check; same DoctorContext + DoctorResult shape
      // as the built-ins. Return null to skip.
    },
  ],
})

// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { prismaDoctor } from './doctor-checks/prisma'

export default defineConfig({ doctor: prismaDoctor })
```

Extra checks run after the built-ins, support async, and merge into the same summary output.

**New exports from `@forinda/kickjs-cli`:**

- `defineDoctorExtension(ext)` — identity helper for an extension bundle (mirrors `defineConfig`)
- `defineDoctorCheck(check)` — identity helper for a single check
- `DoctorExtension`, `DoctorCheck`, `DoctorContext`, `DoctorResult` — type contracts

**Tests:** 29 new in `doctor.test.ts` covering all built-in checks, env-wiring variations (4 file locations × relative/alias imports × before/after bootstrap()), the extensibility hook (sync + async + null-skip), and both identity helpers.

Closes B.4 from the roadmap.
