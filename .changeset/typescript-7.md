---
'@forinda/kickjs-cli': minor
---

`kick new` now scaffolds `typescript: ^7.0.2`.

[TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) (released 2026-07-08) makes `tsc` itself the native Go binary — 8–12× faster full builds, no `@typescript/native-preview` side-install. The generated `tsconfig.json` already used `moduleResolution: 'bundler'` with no `baseUrl`, so it needed no changes; the CLI's generator suite typechecks every scaffolded fixture with `tsc --noEmit` and passes unmodified against 7.0.2.

**Worth knowing before you upgrade an existing project:** TypeScript 7.0 does not ship a compiler API, so tooling that embeds one — webpack's `ts-loader`, Vue/Astro/Svelte language tooling, `typescript-eslint` — cannot run against it. A stock KickJS project uses none of those (typegen parses with `oxc-parser`).

If you have added any, there are three options and none of them is urgent:

- Stay on `typescript@6`. It remains supported; this is a steady state, not a stopgap.
- Install [`@typescript/typescript6`](https://www.npmjs.com/package/@typescript/typescript6) alongside 7 and point that tooling at the `tsc6` binary it provides, so the rest of your build gets the native compiler.
- Wait for the new API, which the TypeScript team expects to ship in 7.1.

Nothing forces the upgrade either way — set the version back in your own `package.json` and everything still works.
