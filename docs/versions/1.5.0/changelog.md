# Changelog

All notable changes to KickJS are documented here.

# Release v1.5.0

## New Features

- feat: add helmet and CORS middleware (#21, #22) ([36dc70a](https://github.com/forinda/kick-js/commit/36dc70a38de2d8f801858a36c36a6c3c8e557004)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: generate in-memory repo for testing when using drizzle/prisma ([b248e8d](https://github.com/forinda/kick-js/commit/b248e8d0b3381302369067e58cc5889618e891cb)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: add git workflow section to AGENTS.md (#43) ([5b122b3](https://github.com/forinda/kick-js/commit/5b122b336593a7780046c4aa22ca2d94583c4e8c)) — @Felix Orinda
- docs: add security headers and CORS guide ([b560671](https://github.com/forinda/kick-js/commit/b5606711c8e5e0e3298ad7e67b6fb3288c7e0623)) — [@forinda](https://github.com/forinda)
- docs: add generated tests section to testing guide ([953313f](https://github.com/forinda/kick-js/commit/953313f6ef13cc22fe57921c9e576e35bf0f1979)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: add dev branch + pre-release workflow (#44) ([cb3706b](https://github.com/forinda/kick-js/commit/cb3706b45d5845499c0bfdfbbaf9f2e9866fd27f)) — @Felix Orinda

## Contributors

- Felix Orinda
- [forinda](https://github.com/forinda)

## Stats

- **6** commits
- **2** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.4.0...v1.5.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.4.0

## New Features

- feat: add built-in request logging middleware (#32) ([b157ed6](https://github.com/forinda/kick-js/commit/b157ed608e01cf74d4152292174e55ac1c578eec)) — [@forinda](https://github.com/forinda)
- feat: add Container.create() for isolated test containers (#26) ([7dc752f](https://github.com/forinda/kick-js/commit/7dc752f63d9cc3e28b71ec3cffaea6d3bebcebcf)) — [@forinda](https://github.com/forinda)
- feat: demonstrate copyDirs in devtools-api + document in VitePress ([815c361](https://github.com/forinda/kick-js/commit/815c361c825b1790ca5a2b266611469941d87191)) — [@forinda](https://github.com/forinda)
- feat(KICK-035): migrate all remaining packages from tsup to Vite build ([df861be](https://github.com/forinda/kick-js/commit/df861be0067b9bdc195668abb8c5da06e585d601)) — [@forinda](https://github.com/forinda)
- feat(KICK-035): migrate @forinda/kickjs-http from tsup to Vite build ([779396d](https://github.com/forinda/kick-js/commit/779396de591944c487091e1ec9f96a073ecc4586)) — [@forinda](https://github.com/forinda)
- feat(KICK-035): migrate @forinda/kickjs-core from tsup to Vite build ([767552f](https://github.com/forinda/kick-js/commit/767552f7d0751ce8ed48ad116cd785ac143dda2b)) — [@forinda](https://github.com/forinda)
- feat(KICK-035): migrate @forinda/kickjs-config from tsup to Vite build ([52be8ec](https://github.com/forinda/kick-js/commit/52be8ecfea13e3c540cdfc9746de2cad82abf0b1)) — [@forinda](https://github.com/forinda)
- feat: migrate kick dev from vite-node to Vite Environment Runner (KICK-034) ([34dc2ca](https://github.com/forinda/kick-js/commit/34dc2cacf9f89239d05d697821ffacd19f954bf8)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: restore colored pino-pretty logs + watch kick.config in dev mode ([31eca63](https://github.com/forinda/kick-js/commit/31eca637a77195672e38b31d3e1690815a84a7b1)) — [@forinda](https://github.com/forinda)
- fix: suppress Vite 8 client environment warnings in kick dev ([8a3a7b0](https://github.com/forinda/kick-js/commit/8a3a7b01058cacb3078ed807bd6cad3c407dec10)) — [@forinda](https://github.com/forinda)
- fix: @Value reads validated env via Container._envResolver (#33, #38) ([5e22963](https://github.com/forinda/kick-js/commit/5e229632cc5feb78b261d2c0c8042bfb6aa23958)) — [@forinda](https://github.com/forinda)
- fix: make createTestApp async, fix middleware typing (#25) ([418a3a9](https://github.com/forinda/kick-js/commit/418a3a9b3ef119d7028fbbd05f7ecc5d00fb731f)) — [@forinda](https://github.com/forinda)
- fix: remove hardcoded enabled:true from devtools-api example ([2ada9c3](https://github.com/forinda/kick-js/commit/2ada9c366301beb0bf5eaf0cfbfb60fafa7ed40d)) — [@forinda](https://github.com/forinda)
- fix: replace npx vite build with programmatic Vite build() API ([814a902](https://github.com/forinda/kick-js/commit/814a902bc1bb07f17da65e27f53315d15b12d73c)) — [@forinda](https://github.com/forinda)
- fix: suppress Vite 7 esbuild/oxc deprecation warning ([47164dc](https://github.com/forinda/kick-js/commit/47164dccda17906898a0eb34d9630fcce8bbefd3)) — [@forinda](https://github.com/forinda)
- fix: improve pino-pretty log formatting ([a292f16](https://github.com/forinda/kick-js/commit/a292f16c7313e36904c9844860e18b53dddda336)) — [@forinda](https://github.com/forinda)
- fix: add both ci and dependencies labels to dependabot github-actions config ([243e779](https://github.com/forinda/kick-js/commit/243e7791e76d0493ccd3dec35e05c49e5e8c2205)) — [@forinda](https://github.com/forinda)
- fix: use existing 'dependencies' label in dependabot.yml for github-actions ([1a22172](https://github.com/forinda/kick-js/commit/1a22172a84a79cb6ade57b38e0cd5fe08b112be3)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: remove vite-node references from current guide pages ([cb4cb96](https://github.com/forinda/kick-js/commit/cb4cb96bab5cc7421ae7a36e869b2c1efd1729b9)) — [@forinda](https://github.com/forinda)
- docs: complete testing guide + pino-pretty troubleshooting (#41, #42) ([4b86653](https://github.com/forinda/kick-js/commit/4b86653672f1875d1ec8d6087bdecdb2d9a733cf)) — [@forinda](https://github.com/forinda)
- docs: update all references from tsup to Vite 8 (KICK-035) ([325037c](https://github.com/forinda/kick-js/commit/325037cd82c67f558263a34edeed0e5376e59b43)) — [@forinda](https://github.com/forinda)
- docs: add KICK-035 roadmap — migrate package builds from tsup to Vite ([2d1020a](https://github.com/forinda/kick-js/commit/2d1020a3ec648cc769dc889f01fb11c1527a0150)) — [@forinda](https://github.com/forinda)
- docs: expand KICK-034 roadmap with Vite Environment migration vision ([2e9a820](https://github.com/forinda/kick-js/commit/2e9a8202492955d10504c55e92dd7777ad9f4e0f)) — [@forinda](https://github.com/forinda)

## Tests

- test: replace all stubs with real tests across jira examples (#24) ([ac63e88](https://github.com/forinda/kick-js/commit/ac63e88be1909b6e99a9524d6929f5a7704021bb)) — [@forinda](https://github.com/forinda)
- test: add real tests for jira-mongoose-api (#24) ([b35e613](https://github.com/forinda/kick-js/commit/b35e613e09beb4b3d0a8077c7e6b4c5594bbd43c)) — [@forinda](https://github.com/forinda)
- test: add auth middleware integration tests to jira-drizzle-api (#24) ([104e8a9](https://github.com/forinda/kick-js/commit/104e8a94e2efaf8743a2820311411d26dacc95f2)) — [@forinda](https://github.com/forinda)
- test: replace all module stubs with real tests in jira-drizzle-api (#24) ([56ff5a9](https://github.com/forinda/kick-js/commit/56ff5a9d4f9541a374a0540e5e42ee7e49ca8107)) — [@forinda](https://github.com/forinda)
- test: replace user module stubs with real tests in jira-drizzle-api (#24) ([4b094c2](https://github.com/forinda/kick-js/commit/4b094c22769974452adac65f050ab56eeeb9d3d7)) — [@forinda](https://github.com/forinda)
- test: add integration tests for 4 example APIs (#24) ([64e0933](https://github.com/forinda/kick-js/commit/64e0933b4115acab9bb846258e934ef51f412ec9)) — [@forinda](https://github.com/forinda)
- test: add integration tests for minimal-api example (#24) ([aa944a0](https://github.com/forinda/kick-js/commit/aa944a0c0981e5e3e21efa93423672c4ca8d7865)) — [@forinda](https://github.com/forinda)

## CI / Infrastructure

- ci: bump actions/setup-node from 4 to 6 ([453bcf0](https://github.com/forinda/kick-js/commit/453bcf0b921a44b62a815253a3382a326a245aec)) — @dependabot[bot]
- ci: bump pnpm/action-setup from 4 to 5 ([9e7b914](https://github.com/forinda/kick-js/commit/9e7b9147a0b77815cef875ff5efed092b0b71b42)) — @dependabot[bot]
- ci: bump actions/deploy-pages from 4 to 5 ([133e68a](https://github.com/forinda/kick-js/commit/133e68a0f6395539c067ef43a1e0d7fdcf062319)) — @dependabot[bot]
- ci: bump actions/upload-pages-artifact from 3 to 4 ([577ccaf](https://github.com/forinda/kick-js/commit/577ccaf06ec55e8f55fdbddae914f6704122f531)) — @dependabot[bot]
- ci: bump actions/checkout from 4 to 6 ([d762633](https://github.com/forinda/kick-js/commit/d762633d71787c5f41015d72d161573b112b1b71)) — @dependabot[bot]

## Maintenance

- chore(KICK-035): remove tsup, hoist vite to workspace root ([13f7287](https://github.com/forinda/kick-js/commit/13f7287678247bfde9b5771816ecca42729e3531)) — [@forinda](https://github.com/forinda)
- chore: bump vite-node to ^6.0.0 in project template + file KICK-034 ([3471778](https://github.com/forinda/kick-js/commit/3471778af7fe96e6a940252857a37c90c360b9d0)) — [@forinda](https://github.com/forinda)
- chore: bump vite-node to ^6.0.0 across all examples + update lockfile ([01f7656](https://github.com/forinda/kick-js/commit/01f7656b41e93cb5d851649313accbb799460571)) — [@forinda](https://github.com/forinda)
- chore: update pnpm-lock.yaml ([139d2fd](https://github.com/forinda/kick-js/commit/139d2fdcd90d487931c83e9d1e3efdac3027e2a0)) — [@forinda](https://github.com/forinda)
- chore: remove deprecated @types/bcryptjs and @types/uuid, bump otel SDK ([69d0915](https://github.com/forinda/kick-js/commit/69d0915338c26eecf31bb32b7284b8cbc7422584)) — [@forinda](https://github.com/forinda)
- chore(deps): bump the production-dependencies group across 1 directory with 8 updates ([b30cfe5](https://github.com/forinda/kick-js/commit/b30cfe55ad9affe57f2b00efd432b6fff400bab4)) — @dependabot[bot]
- chore(deps): bump joi from 17.13.3 to 18.0.2 ([3f02956](https://github.com/forinda/kick-js/commit/3f0295659c473c7469f1753b2a00aa308afd7c00)) — @dependabot[bot]
- chore(deps): bump commander from 13.1.0 to 14.0.3 ([ed5db87](https://github.com/forinda/kick-js/commit/ed5db87a16025f3ccb8e28012a52a4cf5cc5f179)) — @dependabot[bot]

## Contributors

- [forinda](https://github.com/forinda)
- dependabot[bot]

## Stats

- **43** commits
- **2** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.3.2...v1.4.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.3.2

## Bug Fixes

- fix: add default DATABASE_URL fallback in jira-prisma-v7-api prisma.config.ts ([58a939f](https://github.com/forinda/kick-js/commit/58a939f7d0d13a82ca33cd6813b94ffd09b96610)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.3.1...v1.3.2
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.3.1

## Bug Fixes

- fix: set DATABASE_URL in CI for Prisma 7 postinstall generate ([bd45452](https://github.com/forinda/kick-js/commit/bd4545298b85b4d271527373e2850851b7ec767f)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: add all 18 packages to README packages table ([3ded0ce](https://github.com/forinda/kick-js/commit/3ded0cef173e9809f5c7740c9c429cfca20ca02d)) — [@forinda](https://github.com/forinda)
- docs: update bundle sizes in README (cli 173→222 kB, prisma 2.1→2.4 kB) ([0ed2dda](https://github.com/forinda/kick-js/commit/0ed2dda1ff9a71cb22512e80d991a018617c0e4a)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **3** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.3.0...v1.3.1
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.3.0

## New Features

- feat: kick new generates CLAUDE.md and AGENTS.md for AI-assisted development (KICK-033) ([9d72fe1](https://github.com/forinda/kick-js/commit/9d72fe10f54af7cb39c1f38774f22e568c25549f)) — [@forinda](https://github.com/forinda)
- feat: support multiple module names in kick g module and kick rm module ([e4cc73b](https://github.com/forinda/kick-js/commit/e4cc73b3b25cd21c72b597c9bb7306094b6c71b0)) — [@forinda](https://github.com/forinda)
- feat: kick remove module command — delete module and unregister from index (KICK-031) ([fcec6f9](https://github.com/forinda/kick-js/commit/fcec6f92b338d8860e5924cdb089db655a110135)) — [@forinda](https://github.com/forinda)
- feat: PrismaModelDelegate for cast-free repos + updated docs (KICK-028) ([91e2a87](https://github.com/forinda/kick-js/commit/91e2a8722244af74d9ddaddf941ba454e9be082f)) — [@forinda](https://github.com/forinda)
- feat: configurable prismaClientPath + remove any casts in v7 example (KICK-028, KICK-029) ([23b6cb7](https://github.com/forinda/kick-js/commit/23b6cb75c715eb88d7601c177bab8eec965ca9fd)) — [@forinda](https://github.com/forinda)
- feat: Prisma 7 support — adapter logging fallback, driver adapters, jira-prisma-v7-api example (KICK-027) ([b6e9400](https://github.com/forinda/kick-js/commit/b6e94007f2fa70afad82b96eda5ae38a5973b60c)) — [@forinda](https://github.com/forinda)
- feat: type-safe PrismaQueryAdapter + fix jira-prisma-api compilation (KICK-025, KICK-026) ([134897c](https://github.com/forinda/kick-js/commit/134897ca4e3f0f615da2c60409310772e26453a0)) — [@forinda](https://github.com/forinda)
- feat: extensible repo types, working Prisma template, pluralize config, modules config block ([ad8e460](https://github.com/forinda/kick-js/commit/ad8e4602d907f8ed68d9afd89d634d6c1582ad0b)) — [@forinda](https://github.com/forinda)
- feat: add jira-prisma-api example — Jira clone with Prisma ORM and PostgreSQL ([c8d4fb8](https://github.com/forinda/kick-js/commit/c8d4fb8c936840b7b0f74e6d080177c583b17cb6)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: pass defaultRepo from -r flag to initProject in kick new ([3a30154](https://github.com/forinda/kick-js/commit/3a301549f52679dd7ef4d5bbf3ef9a0ccd2208eb)) — [@forinda](https://github.com/forinda)
- fix: add -t flag to kick new examples in AGENTS.md to avoid interactive prompt ([b0cea6a](https://github.com/forinda/kick-js/commit/b0cea6a1b19a599e6882343ef3dd78dcd5a565ca)) — [@forinda](https://github.com/forinda)
- fix: update jira-prisma-v7-api kick.config.ts to use modules block with prismaClientPath ([a2c5345](https://github.com/forinda/kick-js/commit/a2c5345480ae248540ab31de155e7246a8db2a47)) — [@forinda](https://github.com/forinda)
- fix: warn when modules.repo is an unknown string instead of object form (KICK-024) ([2cdd776](https://github.com/forinda/kick-js/commit/2cdd776286e3ad6cf50848f7088d21cffb51476c)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: update CLAUDE.md and AGENTS.md with current project state ([319559b](https://github.com/forinda/kick-js/commit/319559b180319f9f31a66c36560c750d3a8399b4)) — [@forinda](https://github.com/forinda)
- docs: update CLAUDE.md with full framework context + file KICK-032, KICK-033 ([bd83309](https://github.com/forinda/kick-js/commit/bd8330902d2e259e466463f9d5b745c8741c7547)) — [@forinda](https://github.com/forinda)
- docs: add side-by-side PrismaModelDelegate vs full PrismaClient examples ([3e41e51](https://github.com/forinda/kick-js/commit/3e41e51ab0536c71fa8ea32a85233cead04508b8)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: standardize keywords across all 18 packages for npm discoverability ([7674f45](https://github.com/forinda/kick-js/commit/7674f45241baa7df63db6e057d4aa60f4f8d9155)) — [@forinda](https://github.com/forinda)
- chore: remove old versioned docs to reduce build size ([bbbc69b](https://github.com/forinda/kick-js/commit/bbbc69ba301d206a9008a1433d0b79fa58f7de14)) — [@forinda](https://github.com/forinda)
- refactor: CLI generator architecture — TemplateContext, ORM folders, pattern splitting (KICK-030) ([f463db8](https://github.com/forinda/kick-js/commit/f463db8f743119799f4307f91e3199fca29e525d)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **19** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.13...v1.3.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.13

## Documentation

- docs: update example docs and add missing package READMEs ([36f1538](https://github.com/forinda/kick-js/commit/36f15387aad453ab4f789b1cac6067d0b1f7c047)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.12...v1.2.13
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.12

## Bug Fixes

- fix: reduce npm bundle sizes by disabling sourcemaps, enabling minification, and externalizing deps ([c86d4c8](https://github.com/forinda/kick-js/commit/c86d4c825c8a4279ca8f60b6a65b6c95874b392b)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.11...v1.2.12
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.11

## Bug Fixes

- fix: use type-only import for AppDatabase to fix Rollup build ([9ce483a](https://github.com/forinda/kick-js/commit/9ce483a3d16e2956d1b00ce1be2d2a0b7731b6dd)) — [@forinda](https://github.com/forinda)
- fix: upgrade nodemailer to >=7.0.11 to fix CVE-2025-14874 DoS vulnerability ([caeeb03](https://github.com/forinda/kick-js/commit/caeeb03e4f536fec5b022f43653e09ac1280287c)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: add tutorial series to guide — Jira clone + framework deep dives ([0f60599](https://github.com/forinda/kick-js/commit/0f605995a04e8465db3d0bc36ab693d47b477e68)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: update lockfile after examples cleanup ([07fb95d](https://github.com/forinda/kick-js/commit/07fb95d6d5d2a59522e096b9f874e74b4fa834e7)) — [@forinda](https://github.com/forinda)
- refactor: replace 11 single-feature examples with full Jira app showcases ([171c454](https://github.com/forinda/kick-js/commit/171c454cecff95b09451467addeeddd0a1d4ffac)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **5** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.10...v1.2.11
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.10

## New Features

- feat(core,http,drizzle): @ApiQueryParams and ctx.paginate accept DrizzleQueryParamsConfig (KICK-023) ([7e31526](https://github.com/forinda/kick-js/commit/7e31526c36bf0dc0c7508544172b24901c4df1a6)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: add resolved issues (KICK-001 to KICK-023) to roadmap ([8095edf](https://github.com/forinda/kick-js/commit/8095edf4076b0ad7a90dffa7ce38c89399627038)) — [@forinda](https://github.com/forinda)
- docs: update query parsing and decorators for column-object config support ([d8ecb07](https://github.com/forinda/kick-js/commit/d8ecb078efaf48afae869d4b2a757af62ec947c5)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **3** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.9...v1.2.10
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.9

## New Features

- feat(cli): scaffold DrizzleQueryParamsConfig with Column objects (KICK-021) ([911e1e8](https://github.com/forinda/kick-js/commit/911e1e87d153d51575dd04c9e33fcda8f7986e48)) — [@forinda](https://github.com/forinda)
- feat(drizzle): type-safe Column-based query building (KICK-020, KICK-022) ([5152cd7](https://github.com/forinda/kick-js/commit/5152cd79ed798d3c80d736f280b0f2380a19606a)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.8...v1.2.9
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.8

## Bug Fixes

- fix(cli): include vite/client types in generated tsconfig (KICK-019) ([45d1a33](https://github.com/forinda/kick-js/commit/45d1a3364b54b1e014f48a36d89d03bff614189f)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.7...v1.2.8
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.7

## Bug Fixes

- fix(core): persistent decorator registry survives Container.reset() (HMR) ([4596d00](https://github.com/forinda/kick-js/commit/4596d001a3e83cb7b9cd36ff662ca5b5c94f3b72)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore(core): remove unused @Bean and @Configuration decorators ([aa5d821](https://github.com/forinda/kick-js/commit/aa5d8218013a837848a54f2f0586af1a708f3e73)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.6...v1.2.7
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.6

## Bug Fixes

- fix(core): update decorator containerRef on Container.reset() (KICK-017) ([428a477](https://github.com/forinda/kick-js/commit/428a4771b6ccb1d4de05d50a98eed4bba91d7b29)) — [@forinda](https://github.com/forinda)
- fix(queue): auto-register @Job classes before resolving in QueueAdapter (KICK-016) ([9f5a865](https://github.com/forinda/kick-js/commit/9f5a8652a23972375d05bb0a3b77389b19c1a83e)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.5...v1.2.6
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.5

## Bug Fixes

- fix(core): add normalizePath/joinPaths utilities, fix double-slash routes ([f75ace3](https://github.com/forinda/kick-js/commit/f75ace328f46d61bbceb798a85863c964a7a98cb)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.4...v1.2.5
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.4

## Bug Fixes

- fix(http): normalize module path to prevent double-slash routes ([4ba0844](https://github.com/forinda/kick-js/commit/4ba084431fada4f1111566f192cda6debc9f2319)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: rewrite benchmarks guide for user apps, not monorepo ([8fa3464](https://github.com/forinda/kick-js/commit/8fa3464124f540949783e313e8fd2081c0ce0e3f)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.3...v1.2.4
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.3

## New Features

- feat(cli): generate README.md during kick new (KICK-015) ([a6240c7](https://github.com/forinda/kick-js/commit/a6240c724b8bbccf1b41746afd02cbd374a9933e)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix(core): use class name as fallback DI key for HMR (KICK-013) ([4ae3afb](https://github.com/forinda/kick-js/commit/4ae3afb5a2da8df4ac9ff667fb3a5cfe2183e1fb)) — [@forinda](https://github.com/forinda)
- fix(devtools): discover peer adapters at request time (KICK-012) ([6e35fa1](https://github.com/forinda/kick-js/commit/6e35fa1bab25f2e8275f61ed28830cfc48620025)) — [@forinda](https://github.com/forinda)
- fix(mailer): widen nodemailer peer dependency to >=6.0.0 (KICK-002) ([d386d3b](https://github.com/forinda/kick-js/commit/d386d3b7fd4d5f7f2db280255bf1db27ce61206b)) — [@forinda](https://github.com/forinda)
- fix(core): add QueryParamsConfig re-export alias (KICK-014) ([6bf45d8](https://github.com/forinda/kick-js/commit/6bf45d84410f44c0da07506458e96478a3a146cc)) — [@forinda](https://github.com/forinda)
- fix(core): document @Inject as constructor-only, add DI pattern tests (KICK-011) ([52b0af8](https://github.com/forinda/kick-js/commit/52b0af8e47b7ba4894a50944a08fa34f4a37e368)) — [@forinda](https://github.com/forinda)
- fix(config): preserve schema type in defineEnv/loadEnv (KICK-004) ([1f0b9b8](https://github.com/forinda/kick-js/commit/1f0b9b8c2aafc185d04383696b8105abd59d19eb)) — [@forinda](https://github.com/forinda)
- fix(http): remove controller path from routing to prevent path doubling (KICK-007) ([8a77a14](https://github.com/forinda/kick-js/commit/8a77a1409e2be877ce40a42d0a191a4234fe064d)) — [@forinda](https://github.com/forinda)
- fix(http): allow modules without routes to return null (KICK-003) ([bffd43d](https://github.com/forinda/kick-js/commit/bffd43d30b562db43252f851f6365be64bf71319)) — [@forinda](https://github.com/forinda)
- fix(auth): resolve @Public() routes without req.route (KICK-010) ([4e00b26](https://github.com/forinda/kick-js/commit/4e00b26f3e43aa75cf6daf2c8ec158a59c38ea80)) — [@forinda](https://github.com/forinda)
- fix(http): share RequestContext metadata across middleware and handler (KICK-009) ([337773c](https://github.com/forinda/kick-js/commit/337773ce08b1b0c0594533c86ca0d8d71b9f15c9)) — [@forinda](https://github.com/forinda)

## Documentation

- docs(cli): add CI/scriptable examples for kick new (KICK-001) ([81bf4e0](https://github.com/forinda/kick-js/commit/81bf4e091248aeb4ef687ff741b6b110da2bacf3)) — [@forinda](https://github.com/forinda)
- docs(http): document global vs route middleware signature difference (KICK-008) ([275343c](https://github.com/forinda/kick-js/commit/275343c4f823f2c892197f8bad93a667e77686ca)) — [@forinda](https://github.com/forinda)
- docs(queue): fix QueueAdapter queues option type in docs (KICK-005) ([f204436](https://github.com/forinda/kick-js/commit/f204436df83673f74eac38caec675e4116652e69)) — [@forinda](https://github.com/forinda)
- docs(config): document type-safe config patterns and createConfigService (KICK-004) ([015366d](https://github.com/forinda/kick-js/commit/015366d01ad5fe6b47068dee86def2584c3df5f5)) — [@forinda](https://github.com/forinda)
- docs: use HMR-safe Mongoose model pattern in MongoDB guide (KICK-006) ([10217cd](https://github.com/forinda/kick-js/commit/10217cda3e4d016c37ef798330afd8ff8edc2dd9)) — [@forinda](https://github.com/forinda)

## Tests

- test: add workspace integration tests and testing infrastructure ([6384d45](https://github.com/forinda/kick-js/commit/6384d45275fafb26cd52842e49396e0cf31be6cf)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **17** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.2...v1.2.3
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.2

## New Features

- feat(cli): add --dry-run flag to all generators ([0df87fe](https://github.com/forinda/kick-js/commit/0df87fe70c12889c973cd3fac401cec506cfcaca)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.1...v1.2.2
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.1

## Bug Fixes

- fix: replace require('express') with ESM import in DevTools adapter ([413ba80](https://github.com/forinda/kick-js/commit/413ba80b74924298c7849a93efdb2710e3dc0f07)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.2.0...v1.2.1
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.2.0

## New Features

- feat(cli): add pattern-aware generators, CQRS pattern, config-driven defaults, and overwrite protection ([8c804d0](https://github.com/forinda/kick-js/commit/8c804d0a0dfe1c55bf361895e98085326c49a5ab)) — [@forinda](https://github.com/forinda)
- feat: add benchmark suite with autocannon ([c05ca57](https://github.com/forinda/kick-js/commit/c05ca578ef105e92d7d53fabe7d5fd3b268c7b2c)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: add benchmarks guide with usage, metrics, and sample results ([32f6c28](https://github.com/forinda/kick-js/commit/32f6c28dd2d54a1982c6eaa4e000abe09f0a9ea0)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **3** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.1.3...v1.2.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.1.3

## Bug Fixes

- fix: escape angle brackets in changelog to fix VitePress build ([bfee0f3](https://github.com/forinda/kick-js/commit/bfee0f342d9792f6b790b3d6dd9759b9d4ae4521)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.1.2...v1.1.3
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.1.2

## Documentation

- docs: add Socket.IO integration guide ([2dcd2e9](https://github.com/forinda/kick-js/commit/2dcd2e96237f62ecc9fa58e3249291f1facc118e)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.1.1...v1.1.2
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.1.1

## Documentation

- docs: add render, paginate, and SSE to controllers guide ([8b3c6d5](https://github.com/forinda/kick-js/commit/8b3c6d5184e9d3dd40de1adfac8c05181a185083)) — [@forinda](https://github.com/forinda)
- docs: add render, paginate, and sse to HTTP API reference ([b364197](https://github.com/forinda/kick-js/commit/b3641971d193c84c6d1c3151c192f4adaa7e5c54)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.1.0...v1.1.1
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.1.0

## New Features

- feat: MongoDB docs, queue monitoring in DevTools, notification system ([b77a1df](https://github.com/forinda/kick-js/commit/b77a1df0ef5d38fb767459d1e993bb62b940b013)) — [@forinda](https://github.com/forinda)
- feat: add MaybePromise\<T\> utility type, use in adapter and drizzle ([7ceeea2](https://github.com/forinda/kick-js/commit/7ceeea2965aa69694382516b48808fa6a38e0960)) — [@forinda](https://github.com/forinda)
- feat: add `kick tinker` REPL and SpaAdapter for frontend integration ([7a530e3](https://github.com/forinda/kick-js/commit/7a530e3ea73eae91d75c6624e705993dd3f6bf10)) — [@forinda](https://github.com/forinda)
- feat: add @forinda/kickjs-mailer with pluggable MailProvider ([fd55b15](https://github.com/forinda/kick-js/commit/fd55b159e23023db049236cc3c22ed3cdc9aa74e)) — [@forinda](https://github.com/forinda)
- feat: add `kick g scaffold` for field-driven CRUD module generation ([0318023](https://github.com/forinda/kick-js/commit/03180236ba493f09e73d23a9c9cc3a6c2c186fad)) — [@forinda](https://github.com/forinda)
- feat: add @forinda/kickjs-auth with JWT, API key, OAuth, and Passport bridge ([0bd5860](https://github.com/forinda/kick-js/commit/0bd5860e3118afe9e1bbe3692effbb566efc1b6e)) — [@forinda](https://github.com/forinda)
- feat: pluggable cache/cron, HttpStatus constants, colocated tests ([9616029](https://github.com/forinda/kick-js/commit/9616029e447f4c31365ed3fdd1a268692214f180)) — [@forinda](https://github.com/forinda)
- feat: add @Cron scheduler and @Cacheable decorator ([0ef496d](https://github.com/forinda/kick-js/commit/0ef496d03549957a54aa8ddcb54ca0bd34f7f3a9)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: widen onShutdown return type to accept any driver cleanup ([48c853a](https://github.com/forinda/kick-js/commit/48c853a31821bc4413b71aaef9eb527b55d8e068)) — [@forinda](https://github.com/forinda)
- fix: skip HTTP server in kick tinker, clean REPL exit ([a96e643](https://github.com/forinda/kick-js/commit/a96e64395eaf297d19c96c5b639750554e331008)) — [@forinda](https://github.com/forinda)
- fix: run kick tinker under tsx for full TS + decorator support ([62b6d9c](https://github.com/forinda/kick-js/commit/62b6d9cc62d142bb31c431e4c473276c244f8ead)) — [@forinda](https://github.com/forinda)
- fix: resolve @forinda/kickjs-core from user's project in kick tinker ([ea3410e](https://github.com/forinda/kick-js/commit/ea3410e08c2ffe16be490b89a4c343889117b909)) — [@forinda](https://github.com/forinda)
- fix: rename auth docs to authentication.md to fix VitePress routing ([0533137](https://github.com/forinda/kick-js/commit/05331373b2b44dadaedb6a51ab8ab5e0d9a35f01)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: link author name to GitHub profile on Inspiration page ([274cc2a](https://github.com/forinda/kick-js/commit/274cc2af3a2356011d924bb742b796cdc1cb392c)) — [@forinda](https://github.com/forinda)
- docs: add Inspiration page — project motivation and acknowledgements ([d5e968a](https://github.com/forinda/kick-js/commit/d5e968a280fc58a5afd19cb0cfc7a496b2e95729)) — [@forinda](https://github.com/forinda)
- docs: add query parsing with MongoDB (filter, sort, search, pagination) ([d1ab5de](https://github.com/forinda/kick-js/commit/d1ab5dedac079916dc35cc8bb6470381a019e079)) — [@forinda](https://github.com/forinda)
- docs: add kick tinker guide with REPL usage examples ([2e2219d](https://github.com/forinda/kick-js/commit/2e2219d81a9b23e161ef880a526223bd6e9705a8)) — [@forinda](https://github.com/forinda)
- docs: add API reference pages for auth and cron packages ([11236e5](https://github.com/forinda/kick-js/commit/11236e5ab0838e9b910ef4cf2fc96624f796bdef)) — [@forinda](https://github.com/forinda)
- docs: trim roadmap to viable features only ([b1e215a](https://github.com/forinda/kick-js/commit/b1e215ab956a1630b161b78c9dcbe4e9d5b7c461)) — [@forinda](https://github.com/forinda)
- docs: clarify roadmap — separate core features from community patterns ([85dff04](https://github.com/forinda/kick-js/commit/85dff04526ec5e06b06406f0373cbf5617adc1f9)) — [@forinda](https://github.com/forinda)
- docs: update roadmap with v1.x features inspired by Django/Spring/Laravel/Rails ([b386546](https://github.com/forinda/kick-js/commit/b3865466e9f31e97d4cde96dbf7566bde9922594)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: update release script with all 19 packages and 16 examples ([977d1bc](https://github.com/forinda/kick-js/commit/977d1bca7efd9813db0617ac992ac069d013f718)) — [@forinda](https://github.com/forinda)
- chore: update pnpm-lock.yaml for devtools package extraction ([190040e](https://github.com/forinda/kick-js/commit/190040e4277d142892ed6ead1774d765a9dc2dc2)) — [@forinda](https://github.com/forinda)
- refactor: extract DevTools into standalone @forinda/kickjs-devtools package ([3be0f11](https://github.com/forinda/kick-js/commit/3be0f1146bd8d1820ad9e60db4b8ea8b0752332f)) — [@forinda](https://github.com/forinda)
- refactor: move DevTools dashboard to public/ with Vue + Tailwind ([1df0026](https://github.com/forinda/kick-js/commit/1df0026c2464521f2b2a1d3f4a81668c8d451768)) — [@forinda](https://github.com/forinda)
- chore: format graphql example resolver ([5bc7a8e](https://github.com/forinda/kick-js/commit/5bc7a8ebb9ba595642dad50c0da0ac7b4e2f27a2)) — [@forinda](https://github.com/forinda)
- chore: Remove old docs ([6dd3028](https://github.com/forinda/kick-js/commit/6dd30281d430ae197e2c5b51a45a695230c57ce1)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **27** commits
- **1** contributor(s)
- **19** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.0.0...v1.1.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/auth`, `@forinda/kickjs/cron`, `@forinda/kickjs/devtools`, `@forinda/kickjs/drizzle`, `@forinda/kickjs/graphql`, `@forinda/kickjs/mailer`, `@forinda/kickjs/multi-tenant`, `@forinda/kickjs/notifications`, `@forinda/kickjs/otel`, `@forinda/kickjs/prisma`, `@forinda/kickjs/queue`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/ws`, `@forinda/kickjs/vscode-extension`


# Release v1.0.0

## New Features

- feat: add build-time folder copying and pluggable template engine support ([e237d2a](https://github.com/forinda/kick-js/commit/e237d2aab8e235fc4fa4b191a68264d489a3a4f7)) — [@forinda](https://github.com/forinda)
- feat: add GraphQL, queue, microservice, and minimal example APIs ([209a93f](https://github.com/forinda/kick-js/commit/209a93f7ab2aadbd9536bc078fea18c573bcc37e)) — [@forinda](https://github.com/forinda)
- feat: add kick add command with package registry + update CLI docs ([229846d](https://github.com/forinda/kick-js/commit/229846d1c3dfab52f3bc2b0765f4dba78f8df83e)) — [@forinda](https://github.com/forinda)
- feat: add project templates and kick add command ([249e9ec](https://github.com/forinda/kick-js/commit/249e9ecace71dbb25656d0e5819fbb59287ce9c7)) — [@forinda](https://github.com/forinda)
- feat: add kick g resolver, kick g job, QueueProvider interface, and pattern config ([678b507](https://github.com/forinda/kick-js/commit/678b5078a210f24203e7c6d2516a024edb30d7aa)) — [@forinda](https://github.com/forinda)
- feat: add BullMQ, RabbitMQ, Kafka, and Redis Pub/Sub queue providers ([c1746cc](https://github.com/forinda/kick-js/commit/c1746ccbee88df1347e189fc67e8b86e1603d5f6)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: reduce GraphQL bundle from 1.14MB to 8KB + rewrite docs with samples ([7856872](https://github.com/forinda/kick-js/commit/78568724da7570dfb5ebdcf8c9de2485deacfae5)) — [@forinda](https://github.com/forinda)
- fix: GraphQL adapter accepts graphql module as constructor param ([d59c495](https://github.com/forinda/kick-js/commit/d59c495557b24c55b1be6a995f02932981f9796e)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: update landing page to reflect adaptive framework identity ([36fd0bd](https://github.com/forinda/kick-js/commit/36fd0bd78fa6a2c0b6cd5f72af852d33ba3a3cc3)) — [@forinda](https://github.com/forinda)
- docs: add view engines guide and kick.config.ts reference ([e2a84f4](https://github.com/forinda/kick-js/commit/e2a84f402af02940f9c77389b0cbb7d707590080)) — [@forinda](https://github.com/forinda)
- docs: add Express to KickJS migration guide ([25ecbd2](https://github.com/forinda/kick-js/commit/25ecbd267543abf9eed978f406f65cac19206f6f)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **11** commits
- **1** contributor(s)
- **8** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v0.7.0...v1.0.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/prisma`, `@forinda/kickjs/ws`


# Release v0.7.0

## New Features

- feat: add VS Code extension + docs for GraphQL, queue, multi-tenant ([7508042](https://github.com/forinda/kick-js/commit/75080429619bbbe25aa1b53c3a19e4e505241158)) — [@forinda](https://github.com/forinda)
- feat: add GraphQL, queue, multi-tenancy, and kick inspect ([3ba1403](https://github.com/forinda/kick-js/commit/3ba14031d861752636a7c2dd5053166340471a7a)) — [@forinda](https://github.com/forinda)
- feat: add DevTools web dashboard at /_debug with auto-refresh ([20276b1](https://github.com/forinda/kick-js/commit/20276b14410fa997c5a7c72d1e82a4ea68118b11)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: CLI reads version from package.json instead of hardcoding 0.1.0 ([e7f64a9](https://github.com/forinda/kick-js/commit/e7f64a9ee11bb1b148a7a7a2d337c07aaf8bb003)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: update lockfile ([5578b49](https://github.com/forinda/kick-js/commit/5578b4996b325ae8af10bea6569dda8c3a87ded2)) — [@forinda](https://github.com/forinda)
- refactor: extract DevTools dashboard HTML into separate utility file ([4a858a2](https://github.com/forinda/kick-js/commit/4a858a23c77ff14f20276cdaed322c759c098a44)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **6** commits
- **1** contributor(s)
- **8** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v0.6.0...v0.7.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/prisma`, `@forinda/kickjs/ws`


# Release v0.6.0

## New Features

- feat: auto-update docs/changelog.md during release ([1e6545b](https://github.com/forinda/kick-js/commit/1e6545b8da8e913c695e6b6333dc1147c680d540)) — [@forinda](https://github.com/forinda)
- feat: add SSE and OpenTelemetry example APIs ([afa383d](https://github.com/forinda/kick-js/commit/afa383df044593b831e526f645004b671da14040)) — [@forinda](https://github.com/forinda)
- feat: add plugin system for community extensions ([e074965](https://github.com/forinda/kick-js/commit/e0749656bcb93d270407e9494f3c09a09e02f1af)) — [@forinda](https://github.com/forinda)
- feat: add OpenTelemetry adapter and SSE (Server-Sent Events) support ([327d116](https://github.com/forinda/kick-js/commit/327d1162b8c2a137bdbd5896ae367a088fced631)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **4** commits
- **1** contributor(s)
- **8** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v0.5.2...v0.6.0
**Packages**: `@forinda/kickjs/core`, `@forinda/kickjs/config`, `@forinda/kickjs/http`, `@forinda/kickjs/swagger`, `@forinda/kickjs/cli`, `@forinda/kickjs/testing`, `@forinda/kickjs/prisma`, `@forinda/kickjs/ws`


## v0.3.2

- feat: add gh cli release option, typesafe config keys, and .env hot reload ([8a51fb0](https://github.com/forinda/kick-js/commit/8a51fb0)) — [@forinda](https://github.com/forinda)

**Full Changelog**: [v0.3.1...v0.3.2](https://github.com/forinda/kick-js/compare/v0.3.1...v0.3.2)

## v0.3.1

- docs: add README and LICENSE to each package for npm ([72b2d03](https://github.com/forinda/kick-js/commit/72b2d03)) — [@forinda](https://github.com/forinda)
- chore: rename npm scope from @kickjs/\* to @forinda/kickjs-\* ([8368af5](https://github.com/forinda/kick-js/commit/8368af5)) — [@forinda](https://github.com/forinda)

**Full Changelog**: [v0.3.0...v0.3.1](https://github.com/forinda/kick-js/compare/v0.3.0...v0.3.1)

## v0.3.0

### New Features

- feat: add sub-path exports for @forinda/kickjs-core and @forinda/kickjs-http ([8bfb401](https://github.com/forinda/kick-js/commit/8bfb401)) — [@forinda](https://github.com/forinda)
- feat: add monorepo release script with auto release notes ([4398824](https://github.com/forinda/kick-js/commit/4398824)) — [@forinda](https://github.com/forinda)
- feat: add example applications showcasing framework features ([cbd6de3](https://github.com/forinda/kick-js/commit/cbd6de3)) — [@forinda](https://github.com/forinda)
- feat: v0.3.0 monorepo rewrite — custom DI, Express 5, Zod, Vite HMR ([83d41fe](https://github.com/forinda/kick-js/commit/83d41fe)) — [@forinda](https://github.com/forinda)

### Bug Fixes

- fix: address second round of PR review issues ([8f380f2](https://github.com/forinda/kick-js/commit/8f380f2)) — [@forinda](https://github.com/forinda)
- fix: resolve controller per-request to respect DI scoping ([ef11683](https://github.com/forinda/kick-js/commit/ef11683)) — [@forinda](https://github.com/forinda)
- fix: address PR review issues — security, correctness, cross-platform ([85f98ba](https://github.com/forinda/kick-js/commit/85f98ba)) — [@forinda](https://github.com/forinda)
- fix: CI builds only framework packages, not examples ([1180d76](https://github.com/forinda/kick-js/commit/1180d76)) — [@forinda](https://github.com/forinda)
- fix: enforce releases only from main branch ([ac109ab](https://github.com/forinda/kick-js/commit/ac109ab)) — [@forinda](https://github.com/forinda)

### Documentation

- docs: add RELEASE.md with release guide ([e1bb3cf](https://github.com/forinda/kick-js/commit/e1bb3cf)) — [@forinda](https://github.com/forinda)
- docs: complete VitePress documentation — 26 pages ([ae90cc4](https://github.com/forinda/kick-js/commit/ae90cc4)) — [@forinda](https://github.com/forinda)
- docs: add CI pipeline, VitePress site, README, and roadmap ([2378a93](https://github.com/forinda/kick-js/commit/2378a93)) — [@forinda](https://github.com/forinda)

**Full Changelog**: [v0.2.0...v0.3.0](https://github.com/forinda/kick-js/compare/v0.2.0...v0.3.0)

## v0.2.0

- feat: enhance project initialization and CLI commands with improved structure and logging ([b795bf0](https://github.com/forinda/kick-js/commit/b795bf0)) — [@forinda](https://github.com/forinda)

**Full Changelog**: [v0.1.6...v0.2.0](https://github.com/forinda/kick-js/compare/v0.1.6...v0.2.0)
