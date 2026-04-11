# Changelog

All notable changes to KickJS are documented here.

# Release v2.3.3

## Bug Fixes

- fix(cli): kick start on Windows — env vars via spawn, not POSIX prefix ([7d07705](https://github.com/forinda/kick-js/commit/7d07705caecd6e3897f666f532a5386dc511c149)) — [@forinda](https://github.com/forinda)
- fix: windows dev server, hmr env reload, swagger url crash ([6e2947b](https://github.com/forinda/kick-js/commit/6e2947ba7eee7e8d99c568a7afed144a5a9d84fa)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **23** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.3.2...v2.3.3
**Packages**: `@forinda/kickjs-ai`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-mcp`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.3.2

## Bug Fixes

- fix(cli): plugin generator emits valid JSDoc example ([a104e9f](https://github.com/forinda/kick-js/commit/a104e9fed9791bd5e1f8d00be5d219b8a51e49ca)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **23** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.3.1...v2.3.2
**Packages**: `@forinda/kickjs-ai`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-mcp`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.3.1

## Documentation

- docs: list ai + mcp in package indexes, widen keyword coverage ([0587a45](https://github.com/forinda/kick-js/commit/0587a45508e3cd382c918052305c1700db27e11a)) — [@forinda](https://github.com/forinda)
- docs: refresh AI and MCP package READMEs ([d748825](https://github.com/forinda/kick-js/commit/d74882568bafae0ce596c9faebe2ea359074da76)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **23** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.3.0...v2.3.1
**Packages**: `@forinda/kickjs-ai`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-mcp`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.3.0

## New Features

- feat(cli): kick g plugin — scaffold KickPlugin factories ([b4883b5](https://github.com/forinda/kick-js/commit/b4883b5430818529ad0dbb9cd20d9a07d88e401c)) — [@forinda](https://github.com/forinda)
- feat(ai): Qdrant + Pinecone vector stores + AI/MCP docs ([3bf6569](https://github.com/forinda/kick-js/commit/3bf6569175937669ef88260d45ce22c4474e08ad)) — [@forinda](https://github.com/forinda)
- feat(ai): Anthropic provider + getEnv docstring pass ([a2a8608](https://github.com/forinda/kick-js/commit/a2a8608da47bee70e81756582ae015d83ec2ee54)) — [@forinda](https://github.com/forinda)
- feat(ai): Phase D — prompt templates, chat memory, runAgentWithMemory ([8131236](https://github.com/forinda/kick-js/commit/8131236d21be723a1ba24960d390087146ff658a)) — [@forinda](https://github.com/forinda)
- feat(ai): PgVectorStore — pgvector-backed VectorStore implementation ([0135916](https://github.com/forinda/kick-js/commit/0135916ee551a07c0001843415b3a401b4456154)) — [@forinda](https://github.com/forinda)
- feat(ai): RAG primitives — VectorStore interface, InMemoryVectorStore, RagService ([a16f13a](https://github.com/forinda/kick-js/commit/a16f13abc91cb99de0852b5f7db20568a0531cd4)) — [@forinda](https://github.com/forinda)
- feat(cli): wire kick explain --ai to the OpenAI provider ([0da7a64](https://github.com/forinda/kick-js/commit/0da7a64a02577c73696ae8031b667e4668f01ac2)) — [@forinda](https://github.com/forinda)
- feat(ai): @AiTool runtime dispatch + agent loop (Workstream 2 Phase B) ([cd057ea](https://github.com/forinda/kick-js/commit/cd057ea3491836509717fe5e6b2da31b16e06346)) — [@forinda](https://github.com/forinda)
- feat(ai): OpenAI provider implementation + streaming + tool-calling ([6eb1a2b](https://github.com/forinda/kick-js/commit/6eb1a2b9e8eeb76a697b57caf9c4d59f501ab0b9)) — [@forinda](https://github.com/forinda)
- feat(cli): kick explain — pattern-based diagnosis for KickJS pitfalls ([34b618a](https://github.com/forinda/kick-js/commit/34b618a86f91dc1b968d0cb35daa184e385539b0)) — [@forinda](https://github.com/forinda)
- feat(mcp,cli): kick mcp command + stdio transport for MCP servers ([ce00d39](https://github.com/forinda/kick-js/commit/ce00d39f537ca9e9ab984b19f071ab2e9088742a)) — [@forinda](https://github.com/forinda)
- feat(mcp): real tool dispatch via internal HTTP through Express pipeline ([6fd27b5](https://github.com/forinda/kick-js/commit/6fd27b5edb1f6e596f8e54986bb923610adac202)) — [@forinda](https://github.com/forinda)
- feat(mcp): wire @modelcontextprotocol/sdk StreamableHTTP transport ([ccfeef3](https://github.com/forinda/kick-js/commit/ccfeef38bff04c8adae3e3215a32061cce4d275b)) — [@forinda](https://github.com/forinda)
- feat(mcp,ai): scaffold @forinda/kickjs-mcp and @forinda/kickjs-ai packages ([c5ddde4](https://github.com/forinda/kick-js/commit/c5ddde4d98a813c7d0e3083fd0518fe230537d5b)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **14** commits
- **1** contributor(s)
- **23** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.2.5...v2.3.0
**Packages**: `@forinda/kickjs-ai`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-mcp`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.2.5

## New Features

- feat(cli): use pluralize npm package for correct English pluralization ([4050a74](https://github.com/forinda/kick-js/commit/4050a745334e716840b3437a7aae45aa67b6d874)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix(http): skip cluster mode in Vite dev to prevent duplicate servers ([f0519b2](https://github.com/forinda/kick-js/commit/f0519b229e2b4c37d96a05bfd396099a4bb4f5b1)) — [@forinda](https://github.com/forinda)
- fix(cli): update generated CLAUDE.md/AGENTS.md templates ([fb1db5c](https://github.com/forinda/kick-js/commit/fb1db5ce8eca386ff9cd381ec0a99da1083772f2)) — [@forinda](https://github.com/forinda)
- fix(cli): install deps before git init so lockfile is in first commit ([a89f699](https://github.com/forinda/kick-js/commit/a89f699b3c51815c625a3cc8b7875638399bc1fe)) — [@forinda](https://github.com/forinda)
- fix(cli): add :optional syntax and respect pluralize config in generators ([c2918fa](https://github.com/forinda/kick-js/commit/c2918faea458ca71d319bfcf9c7c27584705ef04)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: show real generated code in README and getting-started guides ([00a9b32](https://github.com/forinda/kick-js/commit/00a9b32bbdb45826f508741da6338a86a90e16de)) — [@forinda](https://github.com/forinda)
- docs: add scaffold section, fix outdated concepts in VitePress docs ([f9d0488](https://github.com/forinda/kick-js/commit/f9d04888d7aae319bbaa03cdf087fbc53ad2f2a5)) — [@forinda](https://github.com/forinda)
- docs: update example app setup guide in README, CLAUDE.md, AGENTS.md ([3a922a6](https://github.com/forinda/kick-js/commit/3a922a6ce6743b9543ad5d118a1dcbaa5be44b09)) — [@forinda](https://github.com/forinda)

## Maintenance

- refactor: reduce logging verbosity, clean bootstrap JSDoc ([f5c45cd](https://github.com/forinda/kick-js/commit/f5c45cdee54d50c7a48d4860aebd59ed04ecf7df)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **9** commits
- **1** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.2.4...v2.2.5
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.2.4

## Bug Fixes

- fix(config): reloadEnv preserves the registered schema across .env reloads ([0a832c4](https://github.com/forinda/kick-js/commit/0a832c4bf3599e3ff9d56d8c7377b94a553d4def)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: remove old docs ([94d7c11](https://github.com/forinda/kick-js/commit/94d7c11de2006ec08e322cb282cd374803a352f1)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.2.3...v2.2.4
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.2.3

## New Features

- feat(cli,config): scaffold env into src/config/, auto-wire envWatchPlugin, document the side-effect import ([b5f24ac](https://github.com/forinda/kick-js/commit/b5f24ac03fcc50a7bd112979274a341e6a2093c6)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.2.2...v2.2.3
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.2.2

## Bug Fixes

- fix(docs): escape generic angle brackets in changelog so VitePress builds ([600955a](https://github.com/forinda/kick-js/commit/600955aeb61df2e6a30180e5a540b3c414206125)) — [@forinda](https://github.com/forinda)

## Maintenance

- refactor(config): merge @forinda/kickjs-config into @forinda/kickjs ([b8469cc](https://github.com/forinda/kick-js/commit/b8469cc6230f85d2d2ad87715351e505e5657fba)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.2.1...v2.2.2
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.2.1

## Documentation

- docs(vite): add README; chore(packages): cross-link siblings in keywords ([19b5b12](https://github.com/forinda/kick-js/commit/19b5b127711a05989ab36ff0bdecda578b9914fb)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **1** commits
- **1** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.2.0...v2.2.1
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.2.0

## New Features

- feat: add v3 preview for the new APIs ([c36fffc](https://github.com/forinda/kick-js/commit/c36fffc3fa6febc28002bc31fd9e5294b627a02b)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat(config): defineEnv always merges base schema ([118e84e](https://github.com/forinda/kick-js/commit/118e84e69a946c85d28460ac5cb89e8e860deb9c)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat(cli): scaffolds emit createToken&lt;T&gt; for repository tokens ([377fd6f](https://github.com/forinda/kick-js/commit/377fd6f272f943bbfcbc1dd0e7d77e1467fde03b)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat(config): ConfigService consumes KickEnv (no createConfigService needed) ([ff0d0c0](https://github.com/forinda/kick-js/commit/ff0d0c05e26e925117023e1847d316e7aeaf1090)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: typed @Value + KickEnv from src/env.ts via typegen ([c85acc2](https://github.com/forinda/kick-js/commit/c85acc2335ea1961cbc93ad4851a266ff756de02)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat(cli, docs): scaffolds use Ctx&lt;KickRoutes...&gt; + typegen guide ([2c1bcb7](https://github.com/forinda/kick-js/commit/2c1bcb79802850421772b4baf8eaa041c553772a)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: typed body via Zod schemas (typegen.schemaValidator) ([31d66dc](https://github.com/forinda/kick-js/commit/31d66dcb0b390abd3f26fd8843d3a72585f0899b)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: typed ctx.qs&lt;TConfig&gt;() + @ApiQueryParams typegen ([bef8152](https://github.com/forinda/kick-js/commit/bef81527c127b7a9ddd1bdeb29d5b3efd4f686ae)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: typed RequestContext + URL pattern param typegen ([74c1e68](https://github.com/forinda/kick-js/commit/74c1e6861b7eef0987f3187122e0f845001b4ef0)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: add createToken&lt;T&gt; for collision-safe DI tokens ([068ff45](https://github.com/forinda/kick-js/commit/068ff45da1738f0d3f6dc0533d3e8f62594d9f26)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: add static typegen for type-safe DI resolution ([17e5a33](https://github.com/forinda/kick-js/commit/17e5a3345dcee34ae19ad4d1bdea148aeef0169d)) — [@Felix Orinda](https://github.com/Felix Orinda)

## Bug Fixes

- fix(swagger): unblock Try-it-out CSP and add disableInProd ([5fb7d26](https://github.com/forinda/kick-js/commit/5fb7d268267ed7861f2a2c3f4ab0b08ef7e3e196)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: AppModule.register optional + scaffold emits valid module shape ([7a968f9](https://github.com/forinda/kick-js/commit/7a968f90d401f3adff6f2654cf297338c4a85027)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix(cli): typegen detects token collisions and discovers createToken/Inject ([a3941f6](https://github.com/forinda/kick-js/commit/a3941f6241741fe9490edfbce99d522cf8eeae21)) — [@Felix Orinda](https://github.com/Felix Orinda)

## Documentation

- docs(readme): refresh hello world and example list ([2b42fb2](https://github.com/forinda/kick-js/commit/2b42fb226e394e2fe12adb0711f3b07582add377)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs(readmes): refresh kickjs/swagger/config READMEs ([2866d94](https://github.com/forinda/kick-js/commit/2866d94461f53186e96267919967d7b626b123c3)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: replace overflowing token-hardening table with a list ([52acd95](https://github.com/forinda/kick-js/commit/52acd950758176d541eb51c0465ee7ddb2e6583b)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: lead with createToken&lt;T&gt; instead of raw Symbol() for DI tokens ([e977234](https://github.com/forinda/kick-js/commit/e977234c8b5d54fb2fdf79f65381d919603b518b)) — [@Felix Orinda](https://github.com/Felix Orinda)

## Tests

- test(cli): end-to-end suite covering every generator + typegen ([eb0232e](https://github.com/forinda/kick-js/commit/eb0232e2423e005e937697e73466862ad32946b1)) — [@Felix Orinda](https://github.com/Felix Orinda)

## Contributors

- [Felix Orinda](https://github.com/Felix Orinda)

## Stats

- **19** commits
- **1** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.1.0...v2.2.0
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.1.0

## New Features

- feat: add fallback if one does not have swagger ui dist to resolve CDN ([9358af7](https://github.com/forinda/kick-js/commit/9358af794baa892e3b60cf03e1f3b714f878bd69)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: add customizable onNotFound and onError handlers (#85) ([bee7351](https://github.com/forinda/kick-js/commit/bee735144c25079a97cac331446845ad731e6fbf)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: implement issues #49, #51, #52, #54, #57, #59, #60 ([e2438ef](https://github.com/forinda/kick-js/commit/e2438efbfc326f0c7ebdc0e3a5b33df3452e38fd)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: implement issues #34, #48, #50, #53, #58, #62, #64, #67 ([f3618fa](https://github.com/forinda/kick-js/commit/f3618fac5669277f9221dc297496f93ff3bdc2a3)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: redesign DevTools dashboard with SSE, dependency graph, and detail modal (#85) ([1da1878](https://github.com/forinda/kick-js/commit/1da1878f692cc169e9d1325b2d1b3bb2f2d74a0e)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: DevTools SSE stream uses reactive container.onChange() (#85) ([b947ee1](https://github.com/forinda/kick-js/commit/b947ee1175a5107faf2ffc4b4008e6d434bec0b9)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: serve Swagger UI assets locally from swagger-ui-dist (#85) ([e550b05](https://github.com/forinda/kick-js/commit/e550b0552447cb7530ec307d56597b3553db496b)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: integrate Vite plugin with bootstrap, CLI, and example app (#85) ([dde4890](https://github.com/forinda/kick-js/commit/dde4890c5f27eb6f089114c2c85154a2e7d1e874)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: add module discovery and HMR selective invalidation plugins (#85) ([3cafaa8](https://github.com/forinda/kick-js/commit/3cafaa8e5484ee28a7fa395f145141483ef85c4a)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: add @forinda/kickjs-vite plugin package (#85) ([a8260de](https://github.com/forinda/kick-js/commit/a8260deaa40c9f31dcfdf65d05e425828b58d6f2)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: reactive container with onChange() and invalidate() (#85) ([0be4104](https://github.com/forinda/kick-js/commit/0be410478cb759f67d0f7abe2020a0193fc5da41)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: persistent state layer via globalThis for HMR survival (#85) ([85b385a](https://github.com/forinda/kick-js/commit/85b385ae3664c9b67ad38846136b2bf83ad9f742)) — [@Felix Orinda](https://github.com/Felix Orinda)
- feat: single-port dev server — mount Express on Vite (React Router pattern) (#85) ([1e1e2b1](https://github.com/forinda/kick-js/commit/1e1e2b14a7753991f428156054504512a8e02690)) — [@forinda](https://github.com/forinda)
- feat: v2 showcase example, CLI vite plugin generator, docs (#85) ([bf8edf3](https://github.com/forinda/kick-js/commit/bf8edf31ad97e525d3ba6f4a2b5ec4db5a40ecfd)) — [@forinda](https://github.com/forinda)
- feat: Vite plugin package and typegen command (Phase 7) (#85) ([102f57e](https://github.com/forinda/kick-js/commit/102f57e7b662e8add7c3a5c76c5e2bfd2ae44911)) — [@forinda](https://github.com/forinda)
- feat: migrate build system from Turbo + Vite to wireit + tsdown (Phase 4) (#85) ([b7dc9f6](https://github.com/forinda/kick-js/commit/b7dc9f6c80a4ce3e5721c4bd7f33d019b77d51e1)) — [@forinda](https://github.com/forinda)
- feat: devtools dependency graph, SSE stream, latency percentiles (Phase 6) (#85) ([7c89927](https://github.com/forinda/kick-js/commit/7c89927ebb579fd13fead6cec9f6969be73ab68f)) — [@forinda](https://github.com/forinda)
- feat: request-scoped DI, health checks, production readiness (Phase 5) (#85) ([ba6ec32](https://github.com/forinda/kick-js/commit/ba6ec321334e332427af43328616779bf4442fca)) — [@forinda](https://github.com/forinda)
- feat: HMR stability, async lifecycle, DI observability (Phases 1-3) (#85) ([eb48907](https://github.com/forinda/kick-js/commit/eb48907bb0802ba668ee3f0f555cb70bda1a70a5)) — [@forinda](https://github.com/forinda)
- feat: add bolt logo/banner, sample hello module in starter template ([f5932c2](https://github.com/forinda/kick-js/commit/f5932c25c24396d56fe5091781c3feea0f52d6a0)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: Update fixes for vitest and cli bin ([5e7702d](https://github.com/forinda/kick-js/commit/5e7702dfd1be59cb2e31f9697e68ec84198053f8)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: harden request headers, cluster state tracking, and W3C trace validation ([ebcca9b](https://github.com/forinda/kick-js/commit/ebcca9b6712e6cd79611c30a08f07274a67ca33e)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: resolve vite plugin config timing, request-id array header, and doc typo ([a85df93](https://github.com/forinda/kick-js/commit/a85df93c277b8512bb0dc6bf21cec26d1c3de86d)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: preserve Error stack in logger and isolate metadata from prototype chain ([685bcb2](https://github.com/forinda/kick-js/commit/685bcb28487964b59549b40a92612146d8ccbd9c)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: address review bugs and remove internal details from docs ([a2d80b2](https://github.com/forinda/kick-js/commit/a2d80b2bd68d0e2b11961a63105d9a7d7e730fb6)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: ensure swagger ui dist path is only passed if it's available ([23dd342](https://github.com/forinda/kick-js/commit/23dd3424b35f57f626157e44accf41968df706da)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: fix old reference to cjs to the new esm files ([37a5495](https://github.com/forinda/kick-js/commit/37a54950fb3ed832059e488987ed880c0ce58d59)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: Add error handling in case CLI is not properly loaded ([2145ab3](https://github.com/forinda/kick-js/commit/2145ab379ba2b44b70e22ccecc02a696894e5d77)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: Fix wrong license file reference on the Banner ([aaf888c](https://github.com/forinda/kick-js/commit/aaf888ca168081d10211e5cfeec9579ddadef983)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: fix Deno and Bun CI smoke tests ([5de548e](https://github.com/forinda/kick-js/commit/5de548ed946b63962c36406aad2cee1f45ea3d5f)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: only pass next callback to Express when provided (#85) ([7949b73](https://github.com/forinda/kick-js/commit/7949b73d9ed18e390f808a85eb5ed3f1c5d02184)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: relax Swagger CSP for Vite dev mode (#85) ([dc43e54](https://github.com/forinda/kick-js/commit/dc43e54e31d88375f16ecba52449511f0d6f0037)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: import Container in bootstrap for HMR reset (#85) ([a83acd3](https://github.com/forinda/kick-js/commit/a83acd37bef85fe5b317f0eec57a6df44121d4b9)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: HMR rebuild uses fresh options for new module discovery (#85) ([ff17b2f](https://github.com/forinda/kick-js/commit/ff17b2f056293a60a14f432916ef778367c30360)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: swagger imports from @forinda/kickjs instead of deprecated kickjs-core (#85) ([39429d5](https://github.com/forinda/kick-js/commit/39429d5a7d2e13684182ff83f80fc1cdfb90205c)) — [@Felix Orinda](https://github.com/Felix Orinda)
- fix: simplify Vite plugin — full reload, no surgical HMR (#85) ([a7076b4](https://github.com/forinda/kick-js/commit/a7076b435c5909356a5edffd6fcf3cec7f69c804)) — [@forinda](https://github.com/forinda)
- fix: Express owns the HTTP port, Vite is internal-only (#85) ([68c2a14](https://github.com/forinda/kick-js/commit/68c2a14dc98e86710b4eabda0ea07c3e91cb7e7c)) — [@forinda](https://github.com/forinda)
- fix: remove invalid validate() from global middleware in v2 example (#85) ([3a07bdd](https://github.com/forinda/kick-js/commit/3a07bdd4b3a6619d45875d42b5ffe9589b47792e)) — [@forinda](https://github.com/forinda)
- fix: HMR restarts on new module files and barrel changes (#85) ([f686f93](https://github.com/forinda/kick-js/commit/f686f93ef765877a94fe3281b40f6c35208c2aa9)) — [@forinda](https://github.com/forinda)
- fix: CLI bin uses CJS wrapper (React Router pattern) for Node.js compat (#85) ([0456af0](https://github.com/forinda/kick-js/commit/0456af035998868b388723d8d5fa5cce07c9bedc)) — [@forinda](https://github.com/forinda)
- fix: dev server works with vite CLI — remove middlewareMode (#85) ([546c4d4](https://github.com/forinda/kick-js/commit/546c4d454260deaee3159d53e8d0fbdb871871a4)) — [@forinda](https://github.com/forinda)
- fix: CLI generator uses object repo for custom types, dev runs vite (#85) ([7473251](https://github.com/forinda/kick-js/commit/7473251e649e68239b0fd2399676a846742add2d)) — [@forinda](https://github.com/forinda)
- fix: README hello world registers HelloModule instead of empty array ([2c323b4](https://github.com/forinda/kick-js/commit/2c323b466c0793d397c3620a759ab522366ded8c)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: custom homepage layout, inspiration grid, cleanup nav ([05ee733](https://github.com/forinda/kick-js/commit/05ee7335aeae6ff914f7a2155cf67f8a4a6cf9aa)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: improve docs theme and landing page ([b6c7cc8](https://github.com/forinda/kick-js/commit/b6c7cc87cf182cea56e4c1ba687e206dc0f08be5)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: update latest docs for new features and project structure ([c5c6d7d](https://github.com/forinda/kick-js/commit/c5c6d7d860850bd21d1a73515c8bfbce40caecff)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: update v3 plan with implementation status ([3b0e247](https://github.com/forinda/kick-js/commit/3b0e24721d3d28a9cca7f36bd1406540691a69da)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: update more benchmark docs ([cee1b09](https://github.com/forinda/kick-js/commit/cee1b097abfa2c3615ffe456af0af92a4c3a6054)) — [@Felix Orinda](https://github.com/Felix Orinda)
- docs: add lifecycle audit, request-scoped DI, build banners, devtools and production readiness sections ([2a09f09](https://github.com/forinda/kick-js/commit/2a09f09b18c545d5927f685b70f7117aa84ad78a)) — [@forinda](https://github.com/forinda)

## Tests

- test: restructure test infrastructure and add unit tests for all packages ([c53c448](https://github.com/forinda/kick-js/commit/c53c4489234c59e9c0bf6333349f0efcdb652a65)) — [@Felix Orinda](https://github.com/Felix Orinda)

## Maintenance

- chore: update release scripts ([c2d7b9c](https://github.com/forinda/kick-js/commit/c2d7b9c4fbefa38ff0b14c99df0f7a192bef7e92)) — [@Felix Orinda](https://github.com/Felix Orinda)
- chore: Update cluster to use NodeJS docs ([5fca3bd](https://github.com/forinda/kick-js/commit/5fca3bdd8586337e76a2977de7407e3bf8e7d3d6)) — [@Felix Orinda](https://github.com/Felix Orinda)
- bug: fix kickjs export export root reference to `mjs` and `mts` ([7ad30c1](https://github.com/forinda/kick-js/commit/7ad30c1a90e364f8a0e81b4234925f95f3e1bb13)) — [@Felix Orinda](https://github.com/Felix Orinda)
- chore: remove unwanted markdown files ([c1136a2](https://github.com/forinda/kick-js/commit/c1136a23d6f1724130b5e624db60d654abe1ba20)) — [@Felix Orinda](https://github.com/Felix Orinda)
- chore: replace turbo references with wireit/pnpm in CI and docs (#85) ([9d0e1cd](https://github.com/forinda/kick-js/commit/9d0e1cd52095c459971af94e9fa413c666aaa7ba)) — [@Felix Orinda](https://github.com/Felix Orinda)
- chore: Update lock file ([53c6126](https://github.com/forinda/kick-js/commit/53c6126327f9ed1959124785d1d0ec199d5baa0c)) — [@Felix Orinda](https://github.com/Felix Orinda)
- Update v2 example ([2013179](https://github.com/forinda/kick-js/commit/201317940f6dd4903f9026d1e16762a34a4bd585)) — [@Felix Orinda](https://github.com/Felix Orinda)
- refactor: update CLI generators for unified @forinda/kickjs + vite plugin (#85) ([217d560](https://github.com/forinda/kick-js/commit/217d56005fc1189fa9ce5fbd5c1e33c03edd79ad)) — [@Felix Orinda](https://github.com/Felix Orinda)
- refactor: migrate all packages to metadata utilities (#85) ([1f9c1ba](https://github.com/forinda/kick-js/commit/1f9c1ba6c7fd9a5fc40f9ecec6fec78ef874f175)) — [@Felix Orinda](https://github.com/Felix Orinda)
- refactor: extract Reflect metadata calls to typed utilities (#85) ([22718c1](https://github.com/forinda/kick-js/commit/22718c1ffd3191ef528c21a02fb102117c9ce65b)) — [@Felix Orinda](https://github.com/Felix Orinda)
- chore: Add more docs on framework guides and implementations ([ef571fb](https://github.com/forinda/kick-js/commit/ef571fb629651feec2df75e5d8038b0aee78ce71)) — [@Felix Orinda](https://github.com/Felix Orinda)
- revert: remove @forinda/kickjs-vite plugin, restore old kick dev (#85) ([742010b](https://github.com/forinda/kick-js/commit/742010b7f877edfc23a3770bc9383b41502e2865)) — [@forinda](https://github.com/forinda)
- Add react router inspired re-architecture of our app ([038ad71](https://github.com/forinda/kick-js/commit/038ad71bd69292c6ff2779448322a63051c5ad2b)) — [@forinda](https://github.com/forinda)
- chore(deps): bump dotenv from 16.6.1 to 17.3.1 ([2d975c4](https://github.com/forinda/kick-js/commit/2d975c4bc280014c69c5ee5a95d34fc9b3c3cf9a)) — @dependabot[bot]
- chore(deps): bump @opentelemetry/sdk-trace-base from 1.30.1 to 2.6.1 ([65a591f](https://github.com/forinda/kick-js/commit/65a591fcdd1c8839a1a61d77eaa273c79b74cc3c)) — @dependabot[bot]
- chore(deps): bump @opentelemetry/resources from 1.30.1 to 2.6.1 ([6a61e61](https://github.com/forinda/kick-js/commit/6a61e61ca55a045b4045b9513adcee5ec7d89a44)) — @dependabot[bot]
- chore(deps): bump the production-dependencies group with 2 updates ([6a06ef0](https://github.com/forinda/kick-js/commit/6a06ef04e7e19dc92f02bd32b80e7842787ef34c)) — @dependabot[bot]
- chore(deps-dev): bump the dev-dependencies group with 5 updates ([84cf95f](https://github.com/forinda/kick-js/commit/84cf95f84830a348333b062219bd4f6d050d7f71)) — @dependabot[bot]

## Contributors

- [Felix Orinda](https://github.com/Felix Orinda)
- dependabot[bot]

## Stats

- **68** commits
- **2** contributor(s)
- **21** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.0.1...v2.1.0
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vite`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.0.1

## Documentation

- docs: rewrite READMEs for v2.0 + fix remaining doc references ([c877dcd](https://github.com/forinda/kick-js/commit/c877dcd48f6ce7e959ef105bd38ebd02145521b0)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: Fix docs building ([1706a61](https://github.com/forinda/kick-js/commit/1706a61094469dc12ac14dccaa39adb1600e8a80)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **2** commits
- **1** contributor(s)
- **20** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v2.0.0...v2.0.1
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v2.0.0

## New Features

- feat: export ViewAdapter + SpaAdapter from @forinda/kickjs ([1c1287f](https://github.com/forinda/kick-js/commit/1c1287f61b43e902f79d1c0532066379205d32c3)) — [@forinda](https://github.com/forinda)
- feat(v2): Phase 6 — CLI generates @forinda/kickjs for new projects (#68) ([8e558f7](https://github.com/forinda/kick-js/commit/8e558f772143513385a3c8efa37f94a428fa5e1f)) — [@forinda](https://github.com/forinda)
- feat(v2): Phase 4 — migrate all 16 packages to @forinda/kickjs (#68) ([9fe20c6](https://github.com/forinda/kick-js/commit/9fe20c67406fb156dd3b7ea8e09fb74edf5fed09)) — [@forinda](https://github.com/forinda)

## Bug Fixes

- fix: align versions, restore core vitest alias, fix migration guide ([bc73bc5](https://github.com/forinda/kick-js/commit/bc73bc52449d83424a74d90593b8b07bb75a086f)) — [@forinda](https://github.com/forinda)
- fix: point vitest aliases to unified package + remove poolOptions ([219d0a0](https://github.com/forinda/kick-js/commit/219d0a0713dba8c5ad360ad3c337456b676c35a4)) — [@forinda](https://github.com/forinda)
- fix: remove deprecated poolOptions from http vitest config (vitest 4) ([632192b](https://github.com/forinda/kick-js/commit/632192befd2837876a4219e7243e02fa3a21ddc1)) — [@forinda](https://github.com/forinda)
- fix: vitest alias duplicates + migration guide version numbers ([5e436bf](https://github.com/forinda/kick-js/commit/5e436bf4413fa214eb97c9d1e587be88df57fe49)) — [@forinda](https://github.com/forinda)
- fix: clarify ViewAdapter ships with @forinda/kickjs-http, not unified ([d2e4502](https://github.com/forinda/kick-js/commit/d2e45027123827c8a67049b7fce06da999eaca43)) — [@forinda](https://github.com/forinda)
- fix: address Copilot review — docs, exports, changelog cleanup ([1f734ed](https://github.com/forinda/kick-js/commit/1f734ed3e8635ec21540f42596e8202946344caa)) — [@forinda](https://github.com/forinda)
- fix: add @forinda/kickjs to vite externals in all packages ([a68ecb9](https://github.com/forinda/kick-js/commit/a68ecb978575a6441c9500aa422a34d42984357c)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: use alpha version in migration guide ([f9d79b0](https://github.com/forinda/kick-js/commit/f9d79b0ab32c88d7658faf6db371094a934c6b7d)) — [@forinda](https://github.com/forinda)
- docs: use MiddlewareHandler\<RequestContext\> in JWT auth tutorial ([efbbfcd](https://github.com/forinda/kick-js/commit/efbbfcd972d7db168d101649b66c53782bb31d15)) — [@forinda](https://github.com/forinda)
- docs: fix roadmap entry point count (10 → 30+) ([95903fc](https://github.com/forinda/kick-js/commit/95903fcb649e7ccc137ab972f11dc45c0fc52cd3)) — [@forinda](https://github.com/forinda)
- docs(v2): add v1.x → v2.0 migration guide ([bcc2032](https://github.com/forinda/kick-js/commit/bcc2032729e124ac57a415531dbe780af09f137a)) — [@forinda](https://github.com/forinda)
- docs(v2): Phase 7 — update all docs to @forinda/kickjs (#68) ([db6d4fa](https://github.com/forinda/kick-js/commit/db6d4faab36be53f98aaba82db512639da948d84)) — [@forinda](https://github.com/forinda)

## Maintenance

- wip(v2): Phase 5 — examples keep core+http imports, add kickjs dep ([d02fe15](https://github.com/forinda/kick-js/commit/d02fe158c48ad4e19cb193a8422a0704b6f2dc08)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **16** commits
- **1** contributor(s)
- **20** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.7.1-alpha.0...v2.0.0
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v1.7.1-alpha.0

## New Features

- feat(v2): Phase 3+4 — deprecated shims + migrate all 16 packages (#68) ([e8be927](https://github.com/forinda/kick-js/commit/e8be9272c2dafe7459ddfa6aa32e7c86c568093f)) — [@forinda](https://github.com/forinda)
- feat(v2): unified @forinda/kickjs package — Phase 1+2 complete (#68) ([013b253](https://github.com/forinda/kick-js/commit/013b253ea231ca2073e348727d6a82c1c292faa3)) — [@forinda](https://github.com/forinda)

## Documentation

- docs: update V2_PLAN.md — Phase 3 complete ([5aae35b](https://github.com/forinda/kick-js/commit/5aae35b277cda0921f3ef94800b33de4077d4961)) — [@forinda](https://github.com/forinda)
- docs: update V2_PLAN.md with Phase 5 status and known Vitest issue ([d9b64dc](https://github.com/forinda/kick-js/commit/d9b64dc2d4b39aee484a874eda01a4e89ac97598)) — [@forinda](https://github.com/forinda)

## Tests

- test(v2): Phase 3 — unified package export tests + external project verification ([db385e1](https://github.com/forinda/kick-js/commit/db385e1a9bacf816f2afa8180247a8d941bca232)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore(v2): clean stale build artifacts + update V2_PLAN.md ([4dc062b](https://github.com/forinda/kick-js/commit/4dc062b6ed3310f6fc9b5a40e843a3cf1c8a4551)) — [@forinda](https://github.com/forinda)
- refactor(v2): keep existing packages, build unified @forinda/kickjs alongside ([800b461](https://github.com/forinda/kick-js/commit/800b461990505253fc66b6311b9cff0b13ac7fd3)) — [@forinda](https://github.com/forinda)
- wip(v2): Phase 5 — migrate example imports to @forinda/kickjs (#68) ([716e600](https://github.com/forinda/kick-js/commit/716e6004ced9fa6d1348b1a25cec5490655acd88)) — [@forinda](https://github.com/forinda)
- wip(v2): Phase 3 — deprecated shims for core + http (#68) ([8463b7f](https://github.com/forinda/kick-js/commit/8463b7f49a97ea775269465bb438bbbb527df72c)) — [@forinda](https://github.com/forinda)

## Contributors

- [forinda](https://github.com/forinda)

## Stats

- **9** commits
- **1** contributor(s)
- **20** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.7.0...v1.7.1-alpha.0
**Packages**: `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-core`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-http`, `@forinda/kickjs-kickjs`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v1.7.0

## New Features

- feat: add @forinda/kickjs umbrella package (#61) ([e3a93a2](https://github.com/forinda/kick-js/commit/e3a93a2043e624fa25efdd7d83430b29ee8870df)) — @Felix Orinda
- feat: print route summary on startup in dev mode (#31) (#45) ([96b082c](https://github.com/forinda/kick-js/commit/96b082ccf615e393eb25a52e28dc716762c4788e)) — @Felix Orinda

## Bug Fixes

- fix: hoist methodOrder out of loop, fix Socket.IO adapter afterStart signature ([564b455](https://github.com/forinda/kick-js/commit/564b455c95636483d46e672290e7abf34f979b7d)) — [@forinda](https://github.com/forinda)
- fix: correct ws and queue docs — ws not Socket.IO, bootstrap from http ([cba2fdd](https://github.com/forinda/kick-js/commit/cba2fdd2896779f6daccb7d7cdc7cc6cf28592fd)) — [@forinda](https://github.com/forinda)
- fix: handle unknown HTTP methods in route summary sorting ([0e123bc](https://github.com/forinda/kick-js/commit/0e123bca066c594c2a35a327506d31d1202875d6)) — [@forinda](https://github.com/forinda)
- fix: correct npm scope in project-structure docs (@kickjs → @forinda) ([fa24628](https://github.com/forinda/kick-js/commit/fa2462851ba7330826fdb022bd4c89745f882a73)) — [@forinda](https://github.com/forinda)
- fix: release script generates wrong package names, sort route methods ([5dc8591](https://github.com/forinda/kick-js/commit/5dc85910d0fddaf845c3116489636cda622cc419)) — [@forinda](https://github.com/forinda)
- fix: add files entry to @forinda/kickjs umbrella package ([f024f9d](https://github.com/forinda/kick-js/commit/f024f9dbce4b740bf75d1d3c89cafdfba777bbe3)) — [@forinda](https://github.com/forinda)
- fix: correct clone URL, repo links, and contact info in CONTRIBUTING.md (#56) ([10635a9](https://github.com/forinda/kick-js/commit/10635a9c7fd1ee1b78497a9c9207c5eb3ee9d9f6)) — @Felix Orinda

## Documentation

- docs: add third-party integrations hub + Sentry guide (#66) ([bf30381](https://github.com/forinda/kick-js/commit/bf3038110a54b06d52877bf8d3cf58d3a285c3f3)) — @Felix Orinda
- docs: add Socket.IO custom adapter example to ws docs ([c3c8ec5](https://github.com/forinda/kick-js/commit/c3c8ec5387db6ff8d03da10f50c74564e15b2f5c)) — [@forinda](https://github.com/forinda)

## Maintenance

- chore: release v1.4.1-alpha.0 ([b7bcfcb](https://github.com/forinda/kick-js/commit/b7bcfcba9d74f234ed712e167c3391c19090adbf)) — [@forinda](https://github.com/forinda)
- chore: upgrade vitest 3.x → 4.1.1 and @types/node 24.x → 25.x (#46) (#47) ([d93346c](https://github.com/forinda/kick-js/commit/d93346c51d70ebd07d493ddd1df5bbba85e8faa7)) — @Felix Orinda

## Contributors

- Felix Orinda
- [forinda](https://github.com/forinda)

## Stats

- **13** commits
- **2** contributor(s)
- **20** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.6.0...v1.7.0
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


# Release v1.6.0

## Maintenance

- chore: remove older versioned docs (keep only 1.5.0) ([7bdce50](https://github.com/forinda/kick-js/commit/7bdce50b7a10c98dd5dff20f16a3d30b5e9a2924)) — [@forinda](https://github.com/forinda)
- refactor: auto-discover packages + simplify logging in release script ([45dc294](https://github.com/forinda/kick-js/commit/45dc294f1b0a283a6d012532896a953468202268)) — [@forinda](https://github.com/forinda)
- release: Merge Dev to main for v1.6.0 release (#65) ([1dc9e67](https://github.com/forinda/kick-js/commit/1dc9e67ae14e2c29c636d652325ca1efb2ef1e73)) — @Felix Orinda
- Release: merge dev into main for v1.6.0 (#63) ([a05190a](https://github.com/forinda/kick-js/commit/a05190a614626d946160329ca969f7636c2e451d)) — @Felix Orinda

## Contributors

- [forinda](https://github.com/forinda)
- Felix Orinda

## Stats

- **4** commits
- **2** contributor(s)
- **20** packages published

---

**Full Changelog**: https://github.com/forinda/kick-js/compare/v1.5.0...v1.6.0
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-vscode-extension`, `@forinda/kickjs-ws`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-auth`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-cron`, `@forinda/kickjs-devtools`, `@forinda/kickjs-drizzle`, `@forinda/kickjs-graphql`, `@forinda/kickjs-mailer`, `@forinda/kickjs-multi-tenant`, `@forinda/kickjs-notifications`, `@forinda/kickjs-otel`, `@forinda/kickjs-prisma`, `@forinda/kickjs-queue`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`, `@forinda/kickjs-vscode-extension`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-prisma`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-prisma`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`


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
**Packages**: `@forinda/kickjs`, `@forinda/kickjs-cli`, `@forinda/kickjs-config`, `@forinda/kickjs-prisma`, `@forinda/kickjs-swagger`, `@forinda/kickjs-testing`, `@forinda/kickjs-ws`


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
