---
'@forinda/kickjs-cli': patch
---

Remove the last traces of the `ddd` and `cqrs` patterns, which were dropped
from the generator earlier.

- `KickConfig.pattern`'s JSDoc — what editors show on hover in
  `kick.config.ts` — still listed `'ddd'` and `'cqrs'` while the type only
  accepts `'rest' | 'minimal'`.
- `kick new` printed "Full DDD module (controller, DTOs, use-cases, repo)" for
  `kick g module` in its next steps; it now describes the REST module it
  actually generates. The unreachable `ddd` / `cqrs` hints are gone.
- The DDD `generateController` and `generateModuleIndex` templates, unused by
  any generator since the patterns were removed, are deleted.
