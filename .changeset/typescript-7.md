---
'@forinda/kickjs-cli': minor
---

`kick new` now scaffolds `typescript: ^7.0.2`.

[TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) (released 2026-07-08) makes `tsc` itself the native Go binary — 8–12× faster full builds, no `@typescript/native-preview` side-install. The generated `tsconfig.json` already used `moduleResolution: 'bundler'` with no `baseUrl`, so it needed no changes; the CLI's generator suite typechecks every scaffolded fixture with `tsc --noEmit` and passes unmodified against 7.0.2.

**Worth knowing before you upgrade an existing project:** TypeScript 7.0 does not ship a compiler API. Tooling that embeds one — webpack's `ts-loader`, Vue/Astro/Svelte language tooling, `typescript-eslint` — cannot run on 7.0 and needs 7.1. A stock KickJS project uses none of those (typegen parses with `oxc-parser`), but if you have added any, pin `typescript@6` until 7.1 lands. Nothing forces the upgrade: change the version back in your own `package.json` and everything still works.
