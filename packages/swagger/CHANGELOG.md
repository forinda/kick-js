# @forinda/kickjs-swagger

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
