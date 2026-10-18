---
'@forinda/kickjs-cli': patch
---

Fixes for `kick doctor` on current apps:

- **`express installed`:** no longer fails Fastify and h3 apps; `express` is only needed on the Express runtime.
- **tsconfig parsing:** a `/*` inside a string (the scaffolded `.kickjs/types/**/*.ts` include) is no longer read as a comment. Every new app was reported as having an unreadable tsconfig, and its decorator checks were skipped.
- **env wiring:** the check now detects `loadEnvFromSchema(...)`, which the templates call; until now it never ran on them.

Two new checks:

- **One DI container:** flags `@forinda/kickjs-di` listed next to `@forinda/kickjs`. It is an error when the installed copy differs from the one kickjs pins.
- **Typegen include:** flags a tsconfig that leaves out `.kickjs/types`, includes only its `.d.ts` files, or sets `rootDir: 'src'`.
