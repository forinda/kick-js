# @forinda/kickjs-swagger

## 6.0.1

### Patch Changes

- Updated dependencies [[`edcdb33`](https://github.com/forinda/kick-js/commit/edcdb33bdcba2057dfa325fd8ca0474d73cdb50b)]:
  - @forinda/kickjs-schema@0.1.1

## 6.0.0

### Patch Changes

- [#297](https://github.com/forinda/kick-js/pull/297) [`5615305`](https://github.com/forinda/kick-js/commit/5615305d4bdc7e8db929028a37f8fcbaa07ca82c) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds projects on top of `@forinda/kickjs-schema` instead of the legacy `defineEnv` + raw Zod setup.

  **New `--schema` flag.** Pick the env / DTO validation library at scaffold time:

  ```sh
  kick new my-api --schema zod     # default
  kick new my-api --schema valibot
  kick new my-api --schema yup
  ```

  `--yes` defaults to `zod`. Interactive mode adds a "Schema library" prompt between repo selection and optional packages.

  **Generated env file** now uses `loadEnvFromSchema(fromX(...))` so the same `KickSchema` flows through the env loader, the validate middleware, and the swagger spec generator. The default export is the wrapped schema — `kick typegen` reads it via `InferSchemaOutput<typeof _envSchema>` to populate `KickEnv`. The legacy `defineEnv(...)` + `loadEnv(...)` scaffold path is removed.

  **Generated `kick.config.ts`** sets `typegen.schemaValidator: 'kickjs-schema'` so typegen routes through `InferSchemaOutput` for any wrapped schema — Zod, Valibot, or Yup all work without changing the typegen config.

  **Generated `package.json`** now always installs `@forinda/kickjs-schema` and only the chosen schema lib (`zod` / `valibot` / `yup`), not all three.

  **Swagger** adds adapter-integration tests (`packages/swagger/__tests__/schema-detection.test.ts`) covering real Zod / Valibot / Yup schemas through the `@Post('/', { body: ... })` pipeline + OpenAPI spec generation.

- [#291](https://github.com/forinda/kick-js/pull/291) [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50) Thanks [@forinda](https://github.com/forinda)! - Schema-agnostic validation abstraction

  **New package: `@forinda/kickjs-schema`**
  - `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
  - `SchemaIssue` — normalized error format (path, message, code, expected, received)
  - `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
  - `registerAdapter()` — plug in custom schema libraries at runtime
  - `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

  **Adapters (tree-shakable sub-exports):**
  - `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
  - `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
  - `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

  **Framework integration:**
  - `validate()` middleware uses `detectSchema()` — accepts any supported schema library
  - Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
  - MCP adapter uses `detectSchema()` for tool input/output schema conversion
  - `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

  **Typegen:**
  - New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
  - Default `'zod'` unchanged — fully backward compatible
  - CLI: `kick typegen --schema-validator kickjs-schema`

- Updated dependencies [[`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs-schema@0.1.0

## 6.0.0-alpha.0

### Patch Changes

- [#297](https://github.com/forinda/kick-js/pull/297) [`5615305`](https://github.com/forinda/kick-js/commit/5615305d4bdc7e8db929028a37f8fcbaa07ca82c) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds projects on top of `@forinda/kickjs-schema` instead of the legacy `defineEnv` + raw Zod setup.

  **New `--schema` flag.** Pick the env / DTO validation library at scaffold time:

  ```sh
  kick new my-api --schema zod     # default
  kick new my-api --schema valibot
  kick new my-api --schema yup
  ```

  `--yes` defaults to `zod`. Interactive mode adds a "Schema library" prompt between repo selection and optional packages.

  **Generated env file** now uses `loadEnvFromSchema(fromX(...))` so the same `KickSchema` flows through the env loader, the validate middleware, and the swagger spec generator. The default export is the wrapped schema — `kick typegen` reads it via `InferSchemaOutput<typeof _envSchema>` to populate `KickEnv`. The legacy `defineEnv(...)` + `loadEnv(...)` scaffold path is removed.

  **Generated `kick.config.ts`** sets `typegen.schemaValidator: 'kickjs-schema'` so typegen routes through `InferSchemaOutput` for any wrapped schema — Zod, Valibot, or Yup all work without changing the typegen config.

  **Generated `package.json`** now always installs `@forinda/kickjs-schema` and only the chosen schema lib (`zod` / `valibot` / `yup`), not all three.

  **Swagger** adds adapter-integration tests (`packages/swagger/__tests__/schema-detection.test.ts`) covering real Zod / Valibot / Yup schemas through the `@Post('/', { body: ... })` pipeline + OpenAPI spec generation.

- [#291](https://github.com/forinda/kick-js/pull/291) [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50) Thanks [@forinda](https://github.com/forinda)! - Schema-agnostic validation abstraction

  **New package: `@forinda/kickjs-schema`**
  - `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
  - `SchemaIssue` — normalized error format (path, message, code, expected, received)
  - `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
  - `registerAdapter()` — plug in custom schema libraries at runtime
  - `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

  **Adapters (tree-shakable sub-exports):**
  - `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
  - `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
  - `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

  **Framework integration:**
  - `validate()` middleware uses `detectSchema()` — accepts any supported schema library
  - Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
  - MCP adapter uses `detectSchema()` for tool input/output schema conversion
  - `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

  **Typegen:**
  - New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
  - Default `'zod'` unchanged — fully backward compatible
  - CLI: `kick typegen --schema-validator kickjs-schema`

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0
  - @forinda/kickjs-schema@0.1.0-alpha.0

## 5.3.2

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.3.1

### Patch Changes

- [#262](https://github.com/forinda/kick-js/pull/262) [`fbe82c5`](https://github.com/forinda/kick-js/commit/fbe82c53082ae0c507b8e8ec85cd1fdbecb0e660) Thanks [@forinda](https://github.com/forinda)! - deps: move `zod` to `peerDependencies` in `@forinda/kickjs`; align `@forinda/kickjs-swagger` peer range

  **Why:** Pinning `zod` as a regular `dependency` of `@forinda/kickjs` meant adopters got whichever zod version kickjs happened to ship with — and couldn't upgrade to a newer zod release until kickjs cut a new version. Multiple zod copies in `node_modules` were also possible, with the well-known "schema built with copy A doesn't pass through `parse()` dispatched from copy B" failure mode on minor mismatches.

  Both packages now declare `zod: ^4.0.0` as a **peer dependency**, so the adopter picks the version. Within zod 4.x they can freely upgrade; for a future zod 5 they wait for kickjs to declare support (zod has historically had breaking majors).

  **`@forinda/kickjs`** — `zod` moved from `dependencies` to `peerDependencies` (required, not optional — `baseEnvSchema = z.object(...)` runs at module load when `@forinda/kickjs` is imported, so the framework can't load without zod present).

  **`@forinda/kickjs-swagger`** — peer range tightened from `>=4.0.0` to `^4.0.0` for consistency with kickjs. Stays optional: `schema-parser.ts` duck-types Zod schemas (no `import 'zod'` in `src/`) so adopters using non-Zod parsers (Joi, Valibot, Yup, ArkType) don't need zod at all.

  **Upgrade impact:**
  - Projects scaffolded with `kick new` already pin `zod: ^4.4.3` — no action required.
  - Projects on `npm install`, `yarn` (non-strict), or `pnpm install` without `--strict-peer-dependencies` will see a "missing peer dependency" warning if they don't have zod. Fix: `pnpm add zod` (or your package manager's equivalent).
  - Projects using pnpm with `strict-peer-dependencies=true` or npm 7+ with `--legacy-peer-deps=false` will hard-fail until they add zod themselves.

  No runtime API change. `import { z, baseEnvSchema, defineEnv, loadEnv, ... } from '@forinda/kickjs'` continues to work identically once zod is installed.

## 5.3.0

### Minor Changes

- [#194](https://github.com/forinda/kick-js/pull/194) [`89b429d`](https://github.com/forinda/kick-js/commit/89b429d937c4f5045f00bd9a8bfa6544c8d22110) Thanks [@forinda](https://github.com/forinda)! - Decouple `@forinda/kickjs-swagger` from `@forinda/kickjs-auth`. Swagger now ships its own auth-metadata surface — `@ApiSecurity()`, `@ApiPublic()`, `securityResolver` hook, declarative `securitySchemes` config — and no longer reads the `kick:auth:*` metadata keys from the auth package implicitly.

  ## Why

  The previous behavior had Swagger silently reading `kick:auth:authenticated` / `kick:auth:public` metadata keys set by `@forinda/kickjs-auth`'s decorators. That implicit bridge:
  - Coupled Swagger conceptually to one specific auth library by knowing its metadata key strings.
  - Broke for adopters using a different auth library — their decorators wouldn't show up in the generated spec without monkey-patching.
  - Hid configuration mistakes — typos in scheme names silently produced empty `bearer` schemes.

  ## What's new

  ### `@ApiSecurity(requirement)` — generic security decorator

  Replaces the implicit fallback for adopter-driven security:

  ```ts
  import { ApiSecurity } from '@forinda/kickjs-swagger'

  @Controller('/users')
  @ApiSecurity('BearerAuth')                              // class default
  class UsersController {
    @Get('/me')
    @ApiSecurity({ name: 'OAuth2', scopes: ['users:read'] }) // override + scopes
    me() { ... }

    @Get('/multi')
    @ApiSecurity(['BearerAuth', { name: 'ApiKey' }])         // multiple alternatives
    multi() { ... }
  }
  ```

  Accepts a string, `{ name, scopes? }` object, or array of either. Class-level cascades; method-level overrides win.

  ### `@ApiPublic()` — explicit opt-out

  Mirrors `@Public` from auth packages but in Swagger's namespace:

  ```ts
  @Controller('/internal')
  @ApiSecurity('BearerAuth')
  class Internal {
    @Get('/health')
    @ApiPublic()
    health() { ... }
  }
  ```

  ### `SwaggerOptions.securitySchemes` — declarative scheme registry

  ```ts
  SwaggerAdapter({
    securitySchemes: {
      OAuth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.com/oauth/authorize',
            tokenUrl: 'https://example.com/oauth/token',
            scopes: { 'users:read': 'Read user profile' },
          },
        },
      },
      ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  })
  ```

  Custom scheme names referenced via `@ApiSecurity('MyScheme')` MUST be declared here — the builder no longer auto-synthesizes a bearer scheme for arbitrary names. The literal `BearerAuth` name keeps its auto-synth fallback for back-compat with `@ApiBearerAuth()` / `bearerAuth: true`.

  ### `SwaggerOptions.securityResolver` — bridge hook

  For adopters who want their own auth library's metadata to drive Swagger without touching every controller:

  ```ts
  SwaggerAdapter({
    securityResolver: ({ controllerClass, handlerName }) => {
      const proto = controllerClass.prototype
      if (Reflect.getMetadata('kick:auth:public', proto, handlerName)) return null
      const secured =
        Reflect.getMetadata('kick:auth:authenticated', controllerClass) ||
        Reflect.getMetadata('kick:auth:authenticated', proto, handlerName)
      return secured ? 'BearerAuth' : undefined
    },
  })
  ```

  Returns:
  - A scheme name (or `ApiSecurityRequirement` / array) → emit those requirements.
  - `null` → mark explicitly public (overrides class-level security).
  - `undefined` → fall through to decorator-driven resolution.

  This is the documented escape hatch for adopters who relied on the implicit bridge — same behavior, opt-in.

  ## Migration

  Adopters using `@forinda/kickjs-auth` + Swagger together previously got security-marked routes for free. After this change:
  - **Most adopters** can switch to `@ApiSecurity('BearerAuth')` on the class (or `bearerAuth: true` global).
  - **Adopters who want to keep auth-library-driven detection** copy the `securityResolver` snippet above into their `SwaggerAdapter({...})` call. Behavior matches the historical implicit bridge exactly.

  ## Resolution order
  1. `@ApiPublic()` on the method → no security emitted.
  2. `securityResolver({controllerClass, handlerName})` returns a value (or `null` for public).
  3. `@ApiSecurity` on the method.
  4. `@ApiBearerAuth` on the method.
  5. `@ApiSecurity` on the class.
  6. `@ApiBearerAuth` on the class.

  First match wins.

  ## Tests

  7 new tests covering: `@ApiSecurity` (string/object/array shapes), class→method cascade + override, `@ApiPublic` opt-out, `securityResolver` happy path + `null` → public, `securitySchemes` config respected, custom-scheme refusal-to-auto-synth. The two former `kick:auth:*` bridge tests were dropped since the bridge no longer exists.

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
