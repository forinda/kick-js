# Changelog

All notable changes to KickJS are documented here.

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
