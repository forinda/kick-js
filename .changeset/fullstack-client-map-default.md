---
'@forinda/kickjs-cli': minor
---

`kick new --template fullstack`: the web app now reads the resolved route map

The scaffolded frontend consumes `server/.kickjs/types/kick__client.d.ts` as an
ambient type package rather than bridging to the server's route types:

```jsonc
// web/tsconfig.json
"types": ["../server/.kickjs/types/kick__client"]
```

```ts
// web/src/api.ts
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
```

`web/src/types/kick-routes.d.ts` is gone, and with it `experimentalDecorators`
— the map holds resolved literal types, so no server source enters the web
program. `kick new` runs typegen, so a scaffolded project type-checks
immediately.

A `types` entry rather than `include` because the failure modes differ: a
missing map is `TS2688: Cannot find type definition file` with `types`, and
silence with `include`. Loud is right for something the app depends on. Both
are documented, along with the explicit-import form and the fact that `types`
replaces TypeScript's automatic `@types` inclusion.

The fullstack server therefore pins `@typescript/typescript6`, the compiler API
that resolves the map on TypeScript 7. Only that template does — rest and
minimal have no frontend, and it is a 10 kB shim over a 24 MB `typescript@6`.

One behaviour change worth knowing: the map is not refreshed by `kick dev`, so
a renamed response field surfaces on the next `kick typegen` rather than on
save. `kick typegen --check` catches a stale one in CI.
