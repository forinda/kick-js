# @forinda/kickjs-cli

## 6.4.0

### Minor Changes

- [#445](https://github.com/forinda/kick-js/pull/445) [`bc6db15`](https://github.com/forinda/kick-js/commit/bc6db15edbaf938844ebd9d2595e559c020eea43) Thanks [@forinda](https://github.com/forinda)! - feat: response type inference — `KickRoutes[...].response` is now real

  `kick typegen` emits each route's `response` as a type reference to the
  controller handler itself:

  ```ts
  response: import('@forinda/kickjs').InferHandlerResponse<_C0['get']>
  ```

  Your tsc computes the actual type — the scanner stays checker-free and
  watch-fast. Return-value handlers yield their exact payload
  (`Reply<201, Task>` unwraps to `Task`); imperative `ctx.json` handlers
  degrade to `unknown` exactly as before.

  - `@forinda/kickjs`: new `InferHandlerResponse<H>` type (exported from the
    root, `/web`, and the http barrel)
  - `@forinda/kickjs-cli`: hoisted controller `import type` per (file, class),
    default-export controllers use a `default as` binding;
    `DiscoveredRoute.controllerIsDefaultExport` on both scan paths (AST + regex)

- [#446](https://github.com/forinda/kick-js/pull/446) [`033bae4`](https://github.com/forinda/kick-js/commit/033bae41b2411a20a08363214ff47e0ed3899f57) Thanks [@forinda](https://github.com/forinda)! - feat: `@forinda/kickjs-client` — typed fetch client (R3, closes the response-inference roadmap)

  `kick typegen` now also emits a flat `KickRoutes.Api` map (`'GET /tasks/:id'`
  keys referencing the controller route shapes). The new zero-dependency client
  consumes it:

  ```ts
  import { createClient } from '@forinda/kickjs-client'

  const api = createClient<KickRoutes.Api>({ baseUrl: 'https://x/api/v1' })
  const task = await api.get('/tasks/:id', { params: { id: '42' } })
  //    ^ your handler's actual return type
  ```

  - Paths, params and body constrained per verb at compile time; responses flow
    from return-value handlers via `InferHandlerResponse`
  - Runtime-neutral (fetch/URL/Headers) — browsers, node, Bun, Deno, edge
  - `KickClientError` carries status + parsed RFC 9457 problem body
  - Injectable `fetch` — pass `createWebApp().fetch` for network-free tests

### Patch Changes

- [#448](https://github.com/forinda/kick-js/pull/448) [`d64041d`](https://github.com/forinda/kick-js/commit/d64041dfe997a2060f5a2515ae5fa1dcac472626) Thanks [@forinda](https://github.com/forinda)! - fix: `KickRoutes.Api` keys are now module-mount-joined paths

  The flat client map keyed on the bare decorator path (`'GET /:id'`) instead of
  the mounted path (`'GET /tasks/:id'`) — every mounted controller's typed calls
  404'd, and multi-resource apps collided on `/:id`-style keys with routes
  silently dropped. Fixed by threading `DiscoveredRoute.mountedPath` through both
  scan paths (AST + regex, parity preserved).

  Also from the same review pass:

  - fresh projects with zero routes now still emit an empty `KickRoutes.Api`, so
    `createClient<KickRoutes.Api>` compiles before the first controller exists
  - a controller class named `Api` now triggers a typegen warning (it would
    declaration-merge into the reserved flat map)
  - duplicate-route warnings now say what they mean (a genuine runtime verb+path
    conflict) instead of firing false positives across controllers
  - client: `ShapeOf` fallback is `never` (was all-`unknown`) — generator/client
    key drift fails loudly at the call site instead of silently untyping calls
  - kickjs: `KickRoutes` doc comment updated for the `Api` member + the actual
    generated filename

- Updated dependencies [[`d64041d`](https://github.com/forinda/kick-js/commit/d64041dfe997a2060f5a2515ae5fa1dcac472626), [`860b2d1`](https://github.com/forinda/kick-js/commit/860b2d1fe49fd6c0f94d6f69b6e096878bfb0366), [`ff3e492`](https://github.com/forinda/kick-js/commit/ff3e492bb3261102be774d44730d878399417a46), [`822490f`](https://github.com/forinda/kick-js/commit/822490f293b7616440c5c8c68476daf93d643735), [`7812f43`](https://github.com/forinda/kick-js/commit/7812f437cc3d0fcff09dbba90850360b298e6b1a), [`bc6db15`](https://github.com/forinda/kick-js/commit/bc6db15edbaf938844ebd9d2595e559c020eea43), [`da37fcf`](https://github.com/forinda/kick-js/commit/da37fcf96cd71be68f6aa34f8e08be1f5663201a)]:
  - @forinda/kickjs@6.2.0
  - @forinda/kickjs-db@7.1.1

## 6.3.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

- Updated dependencies [[`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783)]:
  - @forinda/kickjs@6.1.1
  - @forinda/kickjs-cli-kit@0.1.2
  - @forinda/kickjs-db@7.1.1

## 6.3.0

### Minor Changes

- [#425](https://github.com/forinda/kick-js/pull/425) [`d248935`](https://github.com/forinda/kick-js/commit/d248935243ec882085b533d05d1969d85920903e) Thanks [@forinda](https://github.com/forinda)! - typegen: resolve decorated classes at any module depth + `kick typegen --fix`

  Decorated classes (`@Controller`, `@Service`, …) only register at runtime if a
  module's `import.meta.glob([...], { eager: true })` imports their file. When you
  reorganise a module into sub-folders (e.g. moving controllers into
  `controllers/`), a shallow glob stops reaching them — routes silently vanish and
  DI tokens resolve `undefined`. Typegen already detected this; now it helps fix it:

  - **Actionable warning** — orphaned classes are grouped by their owning module
    file, with the exact recursive glob to add (`./**/*.controller.ts`) and a
    `kick typegen --fix` hint.
  - **`kick typegen --fix`** — patches each module's `import.meta.glob(...)` call in
    place (array or bare-string form), adding the missing recursive patterns.
    Idempotent; skips patterns already present.
  - **Scaffold templates** now emit recursive globs that include controllers, so
    newly-generated modules don't orphan when reorganised.

## 6.2.3

### Patch Changes

- Updated dependencies [[`3d877a9`](https://github.com/forinda/kick-js/commit/3d877a9cfb2ff7bea4d1fc965bd62c184ba3a957), [`2c705d7`](https://github.com/forinda/kick-js/commit/2c705d72a8741f46034ff178cec7625969811271), [`8bbf484`](https://github.com/forinda/kick-js/commit/8bbf484d0cbd1fb0abf5a55d21873bef41231e95), [`7864609`](https://github.com/forinda/kick-js/commit/786460934ac035a3d591d7b80d49cdfba6a64a1d)]:
  - @forinda/kickjs@6.1.0
  - @forinda/kickjs-db@7.1.0

## 6.2.2

### Patch Changes

- Updated dependencies [[`732d0f6`](https://github.com/forinda/kick-js/commit/732d0f64d8e5082b6fe8564a73ed1e8daf2c346b)]:
  - @forinda/kickjs@6.0.1
  - @forinda/kickjs-db@7.0.0

## 6.2.1

### Patch Changes

- [#402](https://github.com/forinda/kick-js/pull/402) [`f45f83c`](https://github.com/forinda/kick-js/commit/f45f83c362de15cd7f396814b0eb191a96c6c750) Thanks [@forinda](https://github.com/forinda)! - The post-scaffold "Available:" hint no longer advertises deprecated packages. It was a hardcoded list that included `auth`, `drizzle`, and `prisma` (all deprecated); it's now derived from `PACKAGE_REGISTRY`, filtering out deprecated, core, `:` sub-variants, and db-dialect/schema-lib duplicates — so it can't drift. A test locks it (no deprecated/core names in the list).

- Updated dependencies [[`506f083`](https://github.com/forinda/kick-js/commit/506f083df779256a4f366a936e918da7e43a592b), [`f45f83c`](https://github.com/forinda/kick-js/commit/f45f83c362de15cd7f396814b0eb191a96c6c750)]:
  - @forinda/kickjs@6.0.0
  - @forinda/kickjs-db@7.0.0

## 6.2.0

### Minor Changes

- [#391](https://github.com/forinda/kick-js/pull/391) [`3a3080c`](https://github.com/forinda/kick-js/commit/3a3080c26fca405ad3f3bd34d79a30f1a1b712dd) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds the HTTP runtime explicitly. A new `--runtime express|fastify|h3` flag (and interactive prompt, default `express`) controls:

  - the generated `src/index.ts` — `bootstrap({ runtime: expressRuntime() })` / `fastifyRuntime()` / `h3Runtime()`, imported from the core package (Express) or the `@forinda/kickjs/fastify` / `@forinda/kickjs/h3` subpath;
  - the installed engine peers — Fastify adds `fastify` + `@fastify/middie`, h3 adds `h3` (Express needs nothing extra);
  - the REST template's middleware — `express.json()` is only emitted for Express, since Fastify and h3 parse bodies natively (adding it would consume the body stream twice).

  Making the runtime explicit means switching engines later is a one-line edit, and the scaffold installs exactly the deps the chosen engine needs.

- [#395](https://github.com/forinda/kick-js/pull/395) [`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea) Thanks [@forinda](https://github.com/forinda)! - File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

  **`@forinda/kickjs`**

  - Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
  - New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
  - Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
  - The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

  **`@forinda/kickjs-cli`**

  - `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
  - `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
  - New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
  - `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.

### Patch Changes

- [#399](https://github.com/forinda/kick-js/pull/399) [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f) Thanks [@forinda](https://github.com/forinda)! - The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

  CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.

- [#397](https://github.com/forinda/kick-js/pull/397) [`0606f9b`](https://github.com/forinda/kick-js/commit/0606f9bbf83d449eaf81b53f7f27782b6f33f531) Thanks [@forinda](https://github.com/forinda)! - Fix `kick new --runtime fastify|h3` installing a `@forinda/kickjs` that lacks the engine subpath. The Fastify / h3 runtimes ship on the `alpha` channel for now, but the scaffolder resolved `@forinda/kickjs` from the `latest` dist-tag — so a generated Fastify/h3 app pinned a stable kickjs without the `./fastify` / `./h3` exports and failed to boot under Vite (`"./h3" is not exported …`). The scaffolder now pins `@forinda/kickjs` to the `alpha` channel (exact prerelease version) when a non-Express runtime is chosen, and warns with a manual `add @forinda/kickjs@alpha` hint if the alpha can't be resolved. Express scaffolds stay on the stable channel.

  Also refreshed the generated agent docs (`AGENTS.md` / `CLAUDE.md` / README templates) to describe KickJS as engine-pluggable (Express / Fastify / h3) instead of Express-only, with an explicit "don't assume Express" section, the `runtime` config field, cross-engine uploads, and `kick add upload` / `kick doctor` — so coding agents don't hallucinate an Express-only framework.

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78), [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f)]:
  - @forinda/kickjs@5.18.0
  - @forinda/kickjs-db@7.0.0

## 6.2.0-alpha.2

### Patch Changes

- [#399](https://github.com/forinda/kick-js/pull/399) [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f) Thanks [@forinda](https://github.com/forinda)! - The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

  CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.

- Updated dependencies [[`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f)]:
  - @forinda/kickjs@5.18.0-alpha.1
  - @forinda/kickjs-db@7.0.0-alpha.0

## 6.2.0-alpha.1

### Patch Changes

- [#397](https://github.com/forinda/kick-js/pull/397) [`0606f9b`](https://github.com/forinda/kick-js/commit/0606f9bbf83d449eaf81b53f7f27782b6f33f531) Thanks [@forinda](https://github.com/forinda)! - Fix `kick new --runtime fastify|h3` installing a `@forinda/kickjs` that lacks the engine subpath. The Fastify / h3 runtimes ship on the `alpha` channel for now, but the scaffolder resolved `@forinda/kickjs` from the `latest` dist-tag — so a generated Fastify/h3 app pinned a stable kickjs without the `./fastify` / `./h3` exports and failed to boot under Vite (`"./h3" is not exported …`). The scaffolder now pins `@forinda/kickjs` to the `alpha` channel (exact prerelease version) when a non-Express runtime is chosen, and warns with a manual `add @forinda/kickjs@alpha` hint if the alpha can't be resolved. Express scaffolds stay on the stable channel.

  Also refreshed the generated agent docs (`AGENTS.md` / `CLAUDE.md` / README templates) to describe KickJS as engine-pluggable (Express / Fastify / h3) instead of Express-only, with an explicit "don't assume Express" section, the `runtime` config field, cross-engine uploads, and `kick add upload` / `kick doctor` — so coding agents don't hallucinate an Express-only framework.

## 6.2.0-alpha.0

### Minor Changes

- [#391](https://github.com/forinda/kick-js/pull/391) [`3a3080c`](https://github.com/forinda/kick-js/commit/3a3080c26fca405ad3f3bd34d79a30f1a1b712dd) Thanks [@forinda](https://github.com/forinda)! - `kick new` now scaffolds the HTTP runtime explicitly. A new `--runtime express|fastify|h3` flag (and interactive prompt, default `express`) controls:

  - the generated `src/index.ts` — `bootstrap({ runtime: expressRuntime() })` / `fastifyRuntime()` / `h3Runtime()`, imported from the core package (Express) or the `@forinda/kickjs/fastify` / `@forinda/kickjs/h3` subpath;
  - the installed engine peers — Fastify adds `fastify` + `@fastify/middie`, h3 adds `h3` (Express needs nothing extra);
  - the REST template's middleware — `express.json()` is only emitted for Express, since Fastify and h3 parse bodies natively (adding it would consume the body stream twice).

  Making the runtime explicit means switching engines later is a one-line edit, and the scaffold installs exactly the deps the chosen engine needs.

- [#395](https://github.com/forinda/kick-js/pull/395) [`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea) Thanks [@forinda](https://github.com/forinda)! - File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

  **`@forinda/kickjs`**

  - Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
  - New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
  - Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
  - The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

  **`@forinda/kickjs-cli`**

  - `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
  - `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
  - New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
  - `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0
  - @forinda/kickjs-db@7.0.0-alpha.0

## 6.1.1

### Patch Changes

- [#364](https://github.com/forinda/kick-js/pull/364) [`db882ca`](https://github.com/forinda/kick-js/commit/db882cab2fe971813db11145780584346a0cbc67) Thanks [@forinda](https://github.com/forinda)! - `kick typegen --no-cache` disables the persistent per-file scan cache, re-reading and re-extracting every source file from cold. Escape hatch for the rare `mtimeMs:size` signature collision (a file edited fast enough that its mtime + size are unchanged) where the cache would otherwise serve a stale extract — previously the only recovery was manually deleting `.kickjs/cache`. `runTypegen({ noCache: true })` exposes the same on the programmatic API.

- [#368](https://github.com/forinda/kick-js/pull/368) [`eb4297f`](https://github.com/forinda/kick-js/commit/eb4297fdbc326415ae27b07d8564fb64dbe41753) Thanks [@forinda](https://github.com/forinda)! - `kick add ws` now installs the correct peer dependency. The catalog listed `socket.io`, but `@forinda/kickjs-ws` is built on the `ws` package (`WebSocketServer`) — adopters running `kick add ws` got the wrong library. Fixed the registry entry to `ws`.

- Updated dependencies [[`191935b`](https://github.com/forinda/kick-js/commit/191935bdfe0f8f41ba829ce335ff43536d5cd3a6), [`7e3cbf2`](https://github.com/forinda/kick-js/commit/7e3cbf2d3e1f23b0648f3cb912ccf79cd2b59cec), [`b11a837`](https://github.com/forinda/kick-js/commit/b11a83773e84299e52fbb1b74533b3986972a3bc)]:
  - @forinda/kickjs-db@6.3.0
  - @forinda/kickjs@5.17.0

## 6.1.0

### Minor Changes

- [#348](https://github.com/forinda/kick-js/pull/348) [`134482b`](https://github.com/forinda/kick-js/commit/134482b9ae737d628344f7af9d5b7155e99fadc7) Thanks [@forinda](https://github.com/forinda)! - Refresh the `kick add` catalog. `ai` (`@forinda/kickjs-ai` + zod) and `auth` (`@forinda/kickjs-auth` + jsonwebtoken) are now resolvable — `kick add auth` previously reported "Unknown packages" despite the help text suggesting it. Deprecated entries (`auth` → BYO auth via context contributors, `drizzle`/`prisma` → `@forinda/kickjs-db`) still install but print a migration warning and are flagged in `kick add --list --all`. Catalog resolution is exposed as a pure `planAddPackages()` helper with a drift-guard test that fails if an entry stops matching a published workspace package.

- [#353](https://github.com/forinda/kick-js/pull/353) [`d14d671`](https://github.com/forinda/kick-js/commit/d14d671781e61fab02cc5b05cfff2d2b7044f417) Thanks [@forinda](https://github.com/forinda)! - `kick typegen` per-file extraction is now AST-based (oxc-parser) with the regex extractors kept as a fallback for unparseable mid-edit sources. Accuracy fixes over the regex path: template-literal route paths extract correctly, `@ApiQueryParams` stacked above the HTTP decorator is no longer silently dropped, string literals containing parens/braces can't skew extraction, aliased named imports resolve as schema sources, and const-bound `createToken` declarations are no longer double-emitted. The scan cache version is bumped so stale regex-era entries refresh on first run.

- [#352](https://github.com/forinda/kick-js/pull/352) [`afda925`](https://github.com/forinda/kick-js/commit/afda9253c5e5eb1e8c0dfa668e57d1272c8cc22c) Thanks [@forinda](https://github.com/forinda)! - `kick dev --typecheck` (or `dev.typecheck: true` in kick.config) runs the project's own TypeScript checker after each debounced change and surfaces diagnostics without leaving the dev console. Resolves `tsgo` (`@typescript/native-preview`) from the project's `node_modules/.bin`, falling back to `tsc`; runs `--noEmit` after the typegen pass settles so checks always see fresh `.kickjs/types`. In-flight runs are killed when a new save lands. Failures print a capped diagnostic summary and broadcast a `kickjs:typecheck` HMR event with the full output; a healthy project stays quiet, and the first clean run after an error prints a "clean again" line. Off by default.

- [#348](https://github.com/forinda/kick-js/pull/348) [`630c07d`](https://github.com/forinda/kick-js/commit/630c07d6da38bcbe4b2aae5c3ad55a71e5ca2788) Thanks [@forinda](https://github.com/forinda)! - `kick typegen` now warns when a route decorator's wired `body`/`query`/`params` schema cannot be statically resolved and the generated `KickRoutes` type silently falls back to `unknown` (or URL-pattern params). The warning names the controller, method, route, and schema identifier, and suggests exporting the schema with a static import specifier. No warning is emitted when no schema is wired or when `typegen.schemaValidator` is `false`.

- [#358](https://github.com/forinda/kick-js/pull/358) [`00d6859`](https://github.com/forinda/kick-js/commit/00d6859279877b5f5cfe8445f64f3d91ceb5e7cc) Thanks [@forinda](https://github.com/forinda)! - Two dev-loop fixes:

  **Typegen-on-save for bare `vite` boots.** The vite plugin array now includes `kickjs:typegen`, which wires the same debounced typegen watcher `kick dev` uses — so projects (or tools) that boot Vite directly no longer run with silently frozen `.kickjs/types`. The engine is the CLI's new exported `createTypegenDevWatcher()`; the plugin resolves `@forinda/kickjs-cli` from the project root at runtime (optional peer — manifest-walk resolution, since the ESM-only exports map defeats `require.resolve`) and quietly stands down when the CLI is absent or when `kick dev` has claimed ownership via `TYPEGEN_OWNER_KEY` (no double-running). A startup catch-up pass covers edits made while no dev server was running.

  **Errors now surface on save, not on the next request.** The app module was re-evaluated lazily after HMR/module-discovery invalidation, so a broken save (syntax error, failed import, bootstrap throw) stayed silent until an HTTP request arrived. Both invalidation paths now eagerly re-warm `virtual:kickjs/app` and log the failure (with fixed stacktraces) the moment the save lands — matching the eager startup behavior.

### Patch Changes

- [#348](https://github.com/forinda/kick-js/pull/348) [`6597fcb`](https://github.com/forinda/kick-js/commit/6597fcb9cfc5336303944213d49e9e1b71d24252) Thanks [@forinda](https://github.com/forinda)! - `kick dev` no longer silently swallows typegen failures in watch mode. A failed scan or plugin pass now prints a deduplicated console warning ("types in .kickjs/types may be stale") and broadcasts a `kickjs:typegen-error` custom HMR event for DevTools/overlays. Repeated identical failures stay quiet until the error changes or a pass succeeds again.

- [#348](https://github.com/forinda/kick-js/pull/348) [`78fc8b3`](https://github.com/forinda/kick-js/commit/78fc8b357e838c84630ed27a56fe82674389567e) Thanks [@forinda](https://github.com/forinda)! - `kick info` now reports real data instead of a hardcoded three-package "workspace" list: the CLI's own version, plus every `@forinda/kickjs*` dependency the project declares with the version actually installed in `node_modules` (falling back to the declared range when not installed) and a `[DEPRECATED]` flag for packages the `kick add` catalog marks as deprecated. `kick -v` now works as an alias for `-V` / `--version`.

- [#357](https://github.com/forinda/kick-js/pull/357) [`781db49`](https://github.com/forinda/kick-js/commit/781db49cf1c3e2baced838aa7c07deeb359efa81) Thanks [@forinda](https://github.com/forinda)! - Scaffolded projects now get `"dev": "kick dev"` instead of bare `"dev": "vite"`. The typegen-on-save watcher (and the opt-in `--typecheck` worker) live only in `kick dev` — the bare `vite` script gave working HMR with silently frozen `.kickjs/types`, so adding a route or controller required a manual `kick typegen` to refresh its typing. Existing projects: change the `dev` script in package.json to `kick dev`.

- Updated dependencies [[`bdd9757`](https://github.com/forinda/kick-js/commit/bdd975792ace8fb4e53f542802db7f7610119fcc), [`889fce7`](https://github.com/forinda/kick-js/commit/889fce7f2f02229d8af6bca062fb5642172add8d), [`92c8ce5`](https://github.com/forinda/kick-js/commit/92c8ce5c28384c5e12cad34f1f4c41307b47b966), [`57001c3`](https://github.com/forinda/kick-js/commit/57001c376090cf838db4c9b2dac672a317c21e33), [`e8133d2`](https://github.com/forinda/kick-js/commit/e8133d2c0df13dd59db98637f4ec1a13181ff884)]:
  - @forinda/kickjs-db@6.2.0

## 6.0.1

### Patch Changes

- Updated dependencies [[`fe409a2`](https://github.com/forinda/kick-js/commit/fe409a2ef6c16384271e6536a93c89129bf2bccd)]:
  - @forinda/kickjs-cli-kit@0.1.1
  - @forinda/kickjs-db@6.1.1

## 6.0.0

### Major Changes

- [#329](https://github.com/forinda/kick-js/pull/329) [`e63875d`](https://github.com/forinda/kick-js/commit/e63875ddd772c0981eca086cf9669380d231bd6c) Thanks [@forinda](https://github.com/forinda)! - Lean generators: REST + minimal only, name-based repositories, flat scaffold.

  **Breaking — project templates.** The `ddd` and `cqrs` generator patterns are removed. `kick new` / `kick g module` now offer only `rest` (the new default) and `minimal`. Projects that passed `--template ddd|cqrs` (or set `pattern: 'ddd'|'cqrs'` in `kick.config.ts`) now generate the flat REST layout. Existing hand-written DDD/CQRS code is untouched — only the generators changed.

  **Deprecated — ORM repository presets.** The dedicated `prisma` and `drizzle` repository generators are gone. The repo prompt is now a free-text name: `inmemory` (the zero-dep default, unchanged) or any DB name (e.g. `postgres`, `mongo`) which scaffolds a generic custom-repository stub you wire to your own client. Passing `--repo prisma|drizzle` still works — it just emits the generic stub and prints a deprecation note. Pass a name via `--repo <name>` or `modules.repo: { name: '<name>' }`.

  **`kick g scaffold` now emits the flat REST layout** (controller + service + field-aware DTOs + repository) instead of the removed DDD layout. The `--fields name:type` feature is unchanged; the generated in-memory/custom repository now builds entities by spreading the create DTO, so it works for any field set.

  To keep DDD/CQRS scaffolding, pin to the previous CLI major.

### Minor Changes

- [#334](https://github.com/forinda/kick-js/pull/334) [`f050f6b`](https://github.com/forinda/kick-js/commit/f050f6b235d1fc54f7adc790cd2b5c999411c5c6) Thanks [@forinda](https://github.com/forinda)! - Ship the database CLI from `@forinda/kickjs-db/cli` — a mountable plugin **and** a standalone `kickjs-db` bin — so you can use the db tooling without (or alongside) `@forinda/kickjs-cli`.

  **New: `@forinda/kickjs-db/cli`**

  - `dbCliPlugin` — a CLI plugin (`@forinda/kickjs-cli-kit` contract). Mount it in `kick.config.ts` to get `kick db generate | migrate latest|up|down|rollback|status|review | introspect`. It reads config from the same `kick.config.ts` `db` block (via `ctx.config`, no re-parse).
  - `defineKickDbConfig` / `mergeKickDbConfig` / `resolveKickDbConfig` — vite-style config helpers. Author a standalone `kickjs-db.config.ts` (`export default defineKickDbConfig({ ... })`) or reuse the `kick.config.ts` `db` block; the two merge (later wins).
  - Standalone **`kickjs-db` bin** — `npx kickjs-db migrate latest` runs the whole command tree without kickjs-cli, loading `kickjs-db.config.ts` (or a `kick.config.ts` `db` block) through jiti.

  **Breaking (`@forinda/kickjs-cli`): `kick db` is now opt-in.**
  The `kick db` commands are no longer built into kickjs-cli. Add the plugin to your config:

  ```ts
  import { defineConfig } from '@forinda/kickjs-cli'
  import { dbCliPlugin } from '@forinda/kickjs-db/cli'

  export default defineConfig({ plugins: [dbCliPlugin] })
  ```

  Zero-config **db type generation is unchanged** — it stays a built-in typegen (`kick typegen` still emits `.kickjs/types` for your schema). Only the `kick db` _commands_ moved.

- [#332](https://github.com/forinda/kick-js/pull/332) [`456e280`](https://github.com/forinda/kick-js/commit/456e280eaef89b0d0c357a06edbde6f8e7c2c789) Thanks [@forinda](https://github.com/forinda)! - SQLite migration generation, a `migrate review` command, and drift handling for non-Postgres dialects.

  - **`kick db generate` now emits SQLite DDL** when `db.dialect: 'sqlite'`. Previously the migration emitter was Postgres-only, so SQLite projects couldn't generate migrations from their schema (only the runner worked). The new `emitSqlite` maps PG types to SQLite affinities, normalises defaults (`gen_random_uuid()` → `(lower(hex(randomblob(16))))`, `false` → `0`, `now()` → `CURRENT_TIMESTAMP`), inlines a single integer PK as `INTEGER PRIMARY KEY` (rowid), and folds foreign keys into `CREATE TABLE` (SQLite has no `ALTER ... ADD CONSTRAINT`). Operations SQLite can't express via `ALTER TABLE` (column type/null/default changes, FK changes on an existing table) throw a clear `SqliteRebuildRequiredError` pointing at `kick db generate --empty` instead of emitting wrong SQL. `generate` now dispatches the emitter by dialect.

  - **`kick db migrate review <id>`** marks a migration reviewed: it flips `meta.json.reviewed`, swaps the `-- REVIEWED: false` markers in `up.sql`/`down.sql`, and recomputes the journal hash so all three stay in sync. Previously the only way to review was hand-editing `meta.json`, which left the SQL markers and the hash out of sync (the runner gates on `meta.json.reviewed`, not the comment).

  - **Drift detection is skipped for SQLite/MySQL** — only the Postgres adapter implements `introspect()`, so `kick db migrate` no longer fails with "introspection not supported" on those dialects (PostgreSQL keeps the default `error` behaviour).

- [#327](https://github.com/forinda/kick-js/pull/327) [`bebd92d`](https://github.com/forinda/kick-js/commit/bebd92df749ef4d9de283df066e8074594e338c9) Thanks [@forinda](https://github.com/forinda)! - Incremental asset builds — `buildAssets` no longer re-copies every file on each run.

  `kick build` / `kick build:assets` now skip copying any asset whose destination is already up to date (exists, same byte size, mtime ≥ source), turning a no-change rebuild into a cheap stat sweep instead of a full re-copy. The `.kickjs-assets.json` manifest is still written with every matched file, so output is identical — only redundant copies are elided. `BuildAssetsEntryResult.filesCopied` now reports the number of files actually written (0 when nothing changed).

  `kick dev` wires this into the watcher: when an `assetMap.<ns>.src` directory changes, it runs the incremental asset build (debounced, alongside typegen) so the dist copies + manifest stay fresh without rebuilding everything on every save.

- [#327](https://github.com/forinda/kick-js/pull/327) [`3162704`](https://github.com/forinda/kick-js/commit/316270487b6e3ae4bb1ebc48b59646bd8b29c8e8) Thanks [@forinda](https://github.com/forinda)! - Detect `defineModule()` factory modules in typegen, and quiet per-plugin logs by default.

  - **`ModuleToken` now includes v4 `defineModule()` modules.** The scanner previously only recognised the deprecated `class X implements AppModule` form, so a project using the v4 `export const XModule = defineModule({ ... })` idiom emitted `export type ModuleToken = never`. The scanner now also picks up `defineModule()` consts (per-file, so it's cache/incremental-safe), populating `ModuleToken` with each module name.
  - **Per-plugin typegen status lines are now debug-only.** `kick typegen` printed a `kick/<id>: <status>` line for every plugin on each run. That list is now gated behind `LOG_LEVEL=debug` (or `trace`); a normal run prints just the one-line `kick typegen → …` summary. Set `LOG_LEVEL=debug` to see the full per-plugin breakdown.

- [#327](https://github.com/forinda/kick-js/pull/327) [`db526e9`](https://github.com/forinda/kick-js/commit/db526e958b4237cba62fcaf1f23b22a223a1db0c) Thanks [@forinda](https://github.com/forinda)! - Speed up `kick typegen` / `kick dev` / `kick build` on large projects with a persistent, incremental scanner.

  The typegen scanner used to re-read and re-regex every `src/**/*.ts` file on every run, serially. Two changes cut that cost:

  - **Persistent per-file cache** (`.kickjs/cache/scan.json`, already gitignored): each file's extraction is cached keyed by a cheap `mtimeMs:size` signature, so a watch/rebuild only re-reads genuinely-changed files. Reads + extraction now also run concurrently. Warm scans are ~3× faster than a cold scan.
  - **Walk-free incremental scan in `kick dev`**: the dev server feeds Vite's exact chokidar delta to the scanner, which re-extracts only the changed files and skips the directory walk entirely — ~2.8× faster again than a warm full scan (≈8.5× over the original cold scan on a 1,500-module project).

  Correctness is preserved: the cross-file join (mount-prefix route params, glob-orphan detection) always re-runs over the full cached + fresh extract set, so cached entries can never desync output. File deletions are handled — single-file `unlink` events drop the file from the scan and prune the cache; a directory `unlinkDir` (which carries no precise per-file delta) falls back to a full re-scan. No public API or config changes; the cache is transparent and self-healing (a missing or version-mismatched cache simply behaves like a cold first run).

### Patch Changes

- [#333](https://github.com/forinda/kick-js/pull/333) [`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a) Thanks [@forinda](https://github.com/forinda)! - Extract the CLI-plugin contract into a new dependency-free package, `@forinda/kickjs-cli-kit`.

  `defineCliPlugin`, `defineGenerator`, `KickCliPlugin`, `KickCliPluginContext`, `GeneratorSpec` (+ friends), `KickCommandDefinition`, and `KickPluginConflictError` now live in `@forinda/kickjs-cli-kit`. This lets packages ship `kick`-compatible commands and generators **without** depending on `@forinda/kickjs-cli` — which previously caused a dependency cycle for first-party packages the CLI itself mounts (e.g. the database tooling).

  `@forinda/kickjs-cli` re-exports the whole contract, so existing imports (`import { defineCliPlugin } from '@forinda/kickjs-cli'`) keep working unchanged. The plugin context's config is generic (`KickCliPluginContext<TConfig>`); the CLI narrows it to its `KickConfig`.

  No behaviour change — pure contract extraction.

- [#330](https://github.com/forinda/kick-js/pull/330) [`91cf40f`](https://github.com/forinda/kick-js/commit/91cf40f2925b733dd39d46f3faf8ce29120c84f1) Thanks [@forinda](https://github.com/forinda)! - Fix `kick db` with plugin-importing configs, and non-string column defaults.

  - **`kick db` commands now load `kick.config.ts` through the CLI's jiti loader** (`loadKickConfig`) instead of `@forinda/kickjs-db`'s native `import()`. Native ESM can't resolve the extensionless, relative TypeScript imports a config commonly uses — e.g. `import { toolsPlugin } from './tools/cli-plugin'` to mount a CLI plugin — so every `kick db ...` command failed with `Cannot find module` whenever the config imported local TS. It now resolves exactly like the rest of the CLI.

  - **Column `.default()` accepts `string | number | boolean`** and normalises non-strings to their SQL-literal text. `boolean().default(false)` / `integer().default(0)` previously stored a raw boolean/number in the snapshot, which crashed migration emit with `value.replace is not a function`. The Postgres emitter (`formatDefault`) is also hardened to coerce booleans/numbers defensively, so a pre-existing snapshot with a non-string default emits a bare SQL literal (`false`, `0`) instead of throwing.

- [#331](https://github.com/forinda/kick-js/pull/331) [`4ba020e`](https://github.com/forinda/kick-js/commit/4ba020ed043dc0ee8f696661035891824a3e83f8) Thanks [@forinda](https://github.com/forinda)! - Consolidate the SQL dialect adapters into `@forinda/kickjs-db` subpaths.

  The PostgreSQL / SQLite / MySQL adapters + dialects now ship from **subpaths of `@forinda/kickjs-db`** instead of separate packages — mirroring how `@forinda/kickjs-schema` exposes `./zod` / `./valibot` / `./yup`. Install one package plus the single driver you use:

  ```bash
  # before
  pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg
  # after
  pnpm add @forinda/kickjs-db pg
  ```

  ```ts
  // before
  import { pgAdapter, pgDialect } from '@forinda/kickjs-db-pg'
  // after
  import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
  ```

  - New subpaths: `@forinda/kickjs-db/pg` (now also carries `pgAdapter` + `pgDialect` alongside the PG column types), `@forinda/kickjs-db/sqlite`, `@forinda/kickjs-db/mysql`.
  - `pg`, `better-sqlite3`, `mysql2` are **optional peer deps** of `@forinda/kickjs-db` — the relevant subpath imports its driver lazily, so the core install never pulls all three.
  - `@forinda/kickjs-db-pg` / `-sqlite` / `-mysql` remain as **deprecated re-export shims** (`export * from '@forinda/kickjs-db/<dialect>'`) so existing installs keep working; they'll be removed in a future major.
  - CLI: `kick db` resolves the pg adapter from `@forinda/kickjs-db/pg`; `kick add pg|sqlite|mysql` installs `@forinda/kickjs-db` plus the matching driver.

- [#335](https://github.com/forinda/kick-js/pull/335) [`cda92e7`](https://github.com/forinda/kick-js/commit/cda92e79e0bdc7a6a46c4f428dc10da4ad115a8f) Thanks [@forinda](https://github.com/forinda)! - The `kick/db` type generation now ships on `dbCliPlugin` (exported as `kickDbTypegen` from `@forinda/kickjs-db/cli`), so mounting the plugin brings **both** the `kick db` commands and `.kickjs/types/kick__db.d.ts` generation from one opt-in.

  Previously the db typegen was a kickjs-cli built-in while the commands lived in the plugin — split across two packages. Now `@forinda/kickjs-db/cli` owns the full db CLI surface. kickjs-cli's `kickDbTypegen` export stays as a re-export shim for back-compat, but it is no longer auto-registered — add `dbCliPlugin` to `kick.config.ts` `plugins: []` to get db types (the same mount that enables the commands).

- [#324](https://github.com/forinda/kick-js/pull/324) [`ee9bcff`](https://github.com/forinda/kick-js/commit/ee9bcffe7c9a28617dfd62b1516defd51fc9ea70) Thanks [@forinda](https://github.com/forinda)! - `kick g <generator> <name>` no longer silently scaffolds modules when the generator name fails to route. The bare `kick g <names...>` form is module shorthand and previously sent ANY unmatched first token straight to module generation — so on a CLI older than a given generator (e.g. `contributor`), `kick g contributor tenant` quietly created modules named `contributor` and `tenant` instead of erroring. The fallback now refuses a reserved generator name with a clear message (and an "upgrade your CLI" hint) instead of scaffolding modules. Plain module shorthand (`kick g user task`) is unaffected.

- [#323](https://github.com/forinda/kick-js/pull/323) [`6396452`](https://github.com/forinda/kick-js/commit/639645286383510d662e90008d0dd51b9d8d1875) Thanks [@forinda](https://github.com/forinda)! - `kick add zod | valibot | yup` now installs the schema validator.

  The validator is an optional peer of `@forinda/kickjs` (the framework
  lazy-loads it), so a project that installs one in any other way hits
  `Cannot find module 'zod'` at startup. They weren't in the `kick add`
  registry before (`kick add zod` → "Unknown packages: zod"); now they're
  first-class entries, so existing projects can add or switch schema libs
  in one step. `kick new` already installs the chosen one.

- Updated dependencies [[`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a), [`f050f6b`](https://github.com/forinda/kick-js/commit/f050f6b235d1fc54f7adc790cd2b5c999411c5c6), [`91cf40f`](https://github.com/forinda/kick-js/commit/91cf40f2925b733dd39d46f3faf8ce29120c84f1), [`4ba020e`](https://github.com/forinda/kick-js/commit/4ba020ed043dc0ee8f696661035891824a3e83f8), [`cf3ba8c`](https://github.com/forinda/kick-js/commit/cf3ba8cb56e70385cc6906371d2f8cb3846a2093), [`3b00de4`](https://github.com/forinda/kick-js/commit/3b00de462ebe6f1772cfe0e44c1c04d3a45a4ddf), [`66aae3c`](https://github.com/forinda/kick-js/commit/66aae3cf8c3bd87d14eaa0085d9ca15181fa97fe), [`456e280`](https://github.com/forinda/kick-js/commit/456e280eaef89b0d0c357a06edbde6f8e7c2c789), [`e0e7c34`](https://github.com/forinda/kick-js/commit/e0e7c34ed46b70e1dcfecdf178a7d6f7e774beb9), [`cda92e7`](https://github.com/forinda/kick-js/commit/cda92e79e0bdc7a6a46c4f428dc10da4ad115a8f), [`bcada77`](https://github.com/forinda/kick-js/commit/bcada7784a2e866a512c25856ff1c94ca44ed92b)]:
  - @forinda/kickjs-cli-kit@0.1.0
  - @forinda/kickjs-db@6.1.0
  - @forinda/kickjs@5.16.0

## 5.11.1

### Patch Changes

- [#321](https://github.com/forinda/kick-js/pull/321) [`5dc5a99`](https://github.com/forinda/kick-js/commit/5dc5a991df7c92dd7c369f6f87a3b005ba3dea13) Thanks [@forinda](https://github.com/forinda)! - Fix two `kick dev` (Vite) lifecycle gaps — neither was Windows-specific, though Windows made the shutdown one worse.

  - **App now bootstraps at startup, not on first request.** The dev-server plugin evaluated the app lazily via `ssrLoadModule` inside the request middleware, so `bootstrap()`, adapter `afterStart`, and your startup logs didn't run until the first HTTP request hit. The plugin now warms the module once the HTTP server is listening, so `kick dev` behaves like `node`/`tsx` — logs + adapters + the server come up immediately.
  - **Graceful shutdown now runs on Ctrl+C in dev.** The app deliberately suppresses its own SIGINT/SIGTERM handlers in dev (Vite owns the lifecycle), and the CLI dev server only closed Vite — so `adapter.shutdown()`, request draining, and shutdown logs never ran. `Application.start()` now exposes its `shutdown()` on `globalThis` in dev, and `kick dev` awaits it before tearing down Vite. Also wires `SIGBREAK` (Windows Ctrl+Break) since Windows never raises `SIGTERM`.

- Updated dependencies [[`5dc5a99`](https://github.com/forinda/kick-js/commit/5dc5a991df7c92dd7c369f6f87a3b005ba3dea13)]:
  - @forinda/kickjs@5.15.1
  - @forinda/kickjs-db@6.0.0

## 5.11.0

### Minor Changes

- [#315](https://github.com/forinda/kick-js/pull/315) [`55b7c96`](https://github.com/forinda/kick-js/commit/55b7c9688fcdaa490beca9da41b18dd9e03c70db) Thanks [@forinda](https://github.com/forinda)! - Add the `kick/context` typegen plugin — auto-populate `ContextKeys` from context-decorator key literals.

  `kick typegen` now scans every `defineContextDecorator({ key })` / `defineHttpContextDecorator({ key })` call (including the curried `.withParams<T>()({ key })` form) and emits `.kickjs/types/kick__context.d.ts` augmenting the `ContextKeys` registry. This makes a Context Contributor's `dependsOn` typo-checked automatically — no hand-maintained registry, and no need to give a key a value type in `ContextMeta` just to depend on it.

  Pairs with the `ContextKeys` registry: `dependsOn` narrows to `keyof ContextMeta | keyof ContextKeys`, so the generated augmentation feeds typo-checking while `ContextMeta` keeps driving `ctx.get(key)` value types. The plugin skips emission when no context decorators are found. Scanner gains `extractContextKeysFromSource` + `ScanResult.contextKeys`.

- [#313](https://github.com/forinda/kick-js/pull/313) [`1190b56`](https://github.com/forinda/kick-js/commit/1190b565c8769402c01ae77df6c81dc328aaf79b) Thanks [@forinda](https://github.com/forinda)! - Add `kick g contributor <name>` to scaffold a Context Contributor.

  - `--type http` (default) → `defineHttpContextDecorator`, resolver typed against `RequestContext`.
  - `--type bare` → `defineContextDecorator`, resolver typed against the transport-agnostic `ExecutionContext`.
  - `--params "source:string,region:number"` → emits the curried `.withParams<T>()` form with a generated params `type` alias and `paramDefaults` stub (mirrors how `kick g scaffold` takes field definitions).
  - `--key <key>` overrides the context key (defaults to camelCase of the name); `-m <module>` scopes the file into a module folder.

  The scaffold also drops a `ContextMeta` augmentation stub so `ctx.get('<key>')` is typed and `dependsOn: ['<key>']` is checked.

### Patch Changes

- [#314](https://github.com/forinda/kick-js/pull/314) [`07995b9`](https://github.com/forinda/kick-js/commit/07995b9576e04298d52e0a45b9906360a4da55ac) Thanks [@forinda](https://github.com/forinda)! - Fix two issues in the plugin-only typegen pipeline (follow-up to the generator.ts retirement):

  - **Polling watch never regenerated types.** `kick typegen --watch` / `kick dev` on the polling paths (forced via `KICKJS_WATCH_POLLING`, or the `fs.watch` fallback used on Docker bind mounts / WSL / NFS) ran only the scan + collision gate, not the plugin pass — so no `.kickjs/types/kick__*` file refreshed on change. Both polling paths now drive the full `runLegacy().then(runPlugins)` chain, matching the event-based watcher.
  - **`kick dev` startup could abort on a typegen error.** The startup plugin pass + artifact write were unguarded, so a scanner/fs error would exit the dev server with code 1. Now wrapped in try/catch + warn, consistent with the scan/gate pass and the debounced refresh.

- [#310](https://github.com/forinda/kick-js/pull/310) [`285262f`](https://github.com/forinda/kick-js/commit/285262f1243d6a6623b6c54669ec04fe409ab7d5) Thanks [@forinda](https://github.com/forinda)! - Make `kick typegen` fully plugin-based and retire the legacy monolithic generator.

  The `KickJsRegistry`, `ServiceToken`/`ModuleToken` unions, `KickJsPluginRegistry`, and the `defineAugmentation` catalogue are now each emitted by their own typegen plugin (`kick/registry`, `kick/services`, `kick/modules`, `kick/plugins`, `kick/augmentations`) — joining the already-carved `kick/routes`, `kick/env`, `kick/assets`, `kick/db`. `typegen/generator.ts` is removed; `runTypegen` now just scans, gates collisions, runs the plugin pipeline, and finalises.

  Effects:

  - Output files are renamed to the uniform `kick__*` scheme (`kick__registry.d.ts`, `kick__services.d.ts`, …). The barrel `index.d.ts` is dropped — the scaffolded tsconfig pulls `.kickjs/types/**` in via `include`, so augmentations apply by inclusion and the barrel's re-exports were redundant.
  - The whole pipeline is now uniformly per-plugin-isolated (a throw in one plugin can't block the others).
  - Upgrading is automatic: the first run sweeps the old `index.d.ts` / `registry.d.ts` / `services.d.ts` / `modules.d.ts` / `plugins.d.ts` / `augmentations.d.ts` files.

  Tracking issue [#309](https://github.com/forinda/kick-js/issues/309).

- [#307](https://github.com/forinda/kick-js/pull/307) [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504) Thanks [@forinda](https://github.com/forinda)! - Fix asset manager interfering with controller typegen, and make `assets.x.y()` resolve in dev for `kick.config.ts` projects.

  - **Typegen runner is now per-plugin isolated.** A throw in one typegen plugin (e.g. `kick/assets`) no longer aborts the whole pass — it's reported as an `error` and the remaining plugins (e.g. `kick/routes`) still run. Previously one failing plugin left the controller route types ungenerated.
  - **The stale-file sweep is now an allowlist, not a denylist.** It only removes the known pre-carve legacy filenames (`assets.d.ts`, `env.ts`, `routes.ts`) and never touches unknown/custom files. Previously, when the plugin pass returned nothing (e.g. it aborted), the sweep deleted live `kick__routes.ts` / `kick__assets.d.ts` — wiping controller types project-wide.
  - **Dev-mode asset resolution now works with `kick.config.ts`.** The runtime resolver reads config synchronously and can't transpile TS, so a `.ts`-config project had no manifest to resolve from until the first production build (`assets.x.y()` threw `UnknownAssetError`). The CLI now mirrors the JSON-serialisable `assetMap` + `build.outDir` into `.kickjs/kick.config.json` whenever it loads the config, and the runtime resolver reads that snapshot as a fallback.

- Updated dependencies [[`90299cf`](https://github.com/forinda/kick-js/commit/90299cf76e6aa81776ed109db93ec5dcefea68c7), [`80e0fdf`](https://github.com/forinda/kick-js/commit/80e0fdf30d3d1b7e5d749cb015f77891847eefa6), [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504), [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504)]:
  - @forinda/kickjs@5.15.0
  - @forinda/kickjs-db@6.0.0

## 5.10.2

### Patch Changes

- Updated dependencies []:
  - @forinda/kickjs@5.14.2
  - @forinda/kickjs-db@6.0.0

## 5.10.1

### Patch Changes

- Updated dependencies []:
  - @forinda/kickjs@5.14.1
  - @forinda/kickjs-db@6.0.0

## 5.10.0

### Minor Changes

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

- [#297](https://github.com/forinda/kick-js/pull/297) [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb) Thanks [@forinda](https://github.com/forinda)! - Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

  **`@forinda/kickjs-schema`**

  - `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
  - `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

  **`@forinda/kickjs`**

  - `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

  **`@forinda/kickjs-cli`**

  - `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
  - Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0
  - @forinda/kickjs-db@6.0.0

## 5.10.0-alpha.0

### Minor Changes

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

- [#297](https://github.com/forinda/kick-js/pull/297) [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb) Thanks [@forinda](https://github.com/forinda)! - Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

  **`@forinda/kickjs-schema`**

  - `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
  - `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

  **`@forinda/kickjs`**

  - `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

  **`@forinda/kickjs-cli`**

  - `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
  - Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0
  - @forinda/kickjs-db@6.0.0-alpha.0

## 5.9.1

### Patch Changes

- Updated dependencies [[`53c3938`](https://github.com/forinda/kick-js/commit/53c39381ab6b30b95a67af9900969f4bad2506cc)]:
  - @forinda/kickjs@5.13.1
  - @forinda/kickjs-db@5.9.1

## 5.9.0

### Minor Changes

- [#278](https://github.com/forinda/kick-js/pull/278) [`64e5c2d`](https://github.com/forinda/kick-js/commit/64e5c2d28bc5b1fba92d0742d04def9c60d697bc) Thanks [@forinda](https://github.com/forinda)! - feat(cli): `kick doctor` — pre-flight checks for dev environment

  New CLI command that catches common "doesn't work on my machine" misconfigs before they bite. Sibling to `kick check --deploy` (which scans for production-readiness); doctor is the dev-setup counterpart.

  ```bash
  kick doctor
  ```

  Sample output:

  ```text
  KickJS Doctor

  ✔  Node version  (v22.7.0)
  ✔  @forinda/kickjs installed  (^5.12.0)
  ✔  express installed  (^5.1.0)
  ✔  reflect-metadata installed  (^0.2.2)
  ✔  tsconfig: experimentalDecorators
  ✔  tsconfig: emitDecoratorMetadata
  ✔  env wiring
  ✔  typegen freshness  (2m ago)

  8 passed, 0 warnings, 0 errors — your environment looks good
  ```

  Exit code is `0` on pass-or-warn, `1` on any error.

  **Built-in checks (this first pass):**

  | Check                              | Severity     | Detects                                                                                                                                                                                   |
  | ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Node version                       | error        | Node < 20                                                                                                                                                                                 |
  | `@forinda/kickjs` installed        | error        | Wrong directory / fresh repo                                                                                                                                                              |
  | `express` installed                | error        | Required peer dep missing                                                                                                                                                                 |
  | `reflect-metadata` installed       | error        | Decorator polyfill missing                                                                                                                                                                |
  | tsconfig: `experimentalDecorators` | error        | Decorators won't compile                                                                                                                                                                  |
  | tsconfig: `emitDecoratorMetadata`  | error        | DI container can't read constructor types                                                                                                                                                 |
  | env wiring                         | error / warn | env-init file (`src/env.ts`, `src/env/index.ts`, `src/config/env.ts`, `src/config/index.ts`) calls `loadEnv(...)` but the app entry doesn't import it — or imports it AFTER `bootstrap()` |
  | typegen freshness                  | warn         | `.kickjs/types/` last touched > 60 min ago                                                                                                                                                |

  The env-wiring check handles common file-location variations and accepts both relative (`'./env'`, `'./config/env'`) and `@/`-aliased (`'@/env'`, `'@/config'`) imports. Detects the canonical "ConfigService.get() returns undefined while @Value() works" footgun.

  **No ORM-specific checks in core.** The framework stays stack-agnostic — Prisma / Drizzle / Mongoose checks belong in adopter config (or in adapter packages that ship doctor extensions).

  **Extensibility — `defineDoctorExtension`:**

  ```ts
  // doctor-checks/prisma.ts (publishable as a package, or workspace-shared)
  import { defineDoctorExtension } from '@forinda/kickjs-cli'

  export const prismaDoctor = defineDoctorExtension({
    checks: [
      (ctx) => {
        // adopter-defined check; same DoctorContext + DoctorResult shape
        // as the built-ins. Return null to skip.
      },
    ],
  })

  // kick.config.ts
  import { defineConfig } from '@forinda/kickjs-cli'
  import { prismaDoctor } from './doctor-checks/prisma'

  export default defineConfig({ doctor: prismaDoctor })
  ```

  Extra checks run after the built-ins, support async, and merge into the same summary output.

  **New exports from `@forinda/kickjs-cli`:**

  - `defineDoctorExtension(ext)` — identity helper for an extension bundle (mirrors `defineConfig`)
  - `defineDoctorCheck(check)` — identity helper for a single check
  - `DoctorExtension`, `DoctorCheck`, `DoctorContext`, `DoctorResult` — type contracts

  **Tests:** 29 new in `doctor.test.ts` covering all built-in checks, env-wiring variations (4 file locations × relative/alias imports × before/after bootstrap()), the extensibility hook (sync + async + null-skip), and both identity helpers.

  Closes B.4 from the roadmap.

### Patch Changes

- Updated dependencies [[`ace5e84`](https://github.com/forinda/kick-js/commit/ace5e8499b74a7b333fa6c6024f53ab5f5fd6ea8), [`a46927e`](https://github.com/forinda/kick-js/commit/a46927e9102ea67d25df633df2a55d782ab23a3c), [`7101444`](https://github.com/forinda/kick-js/commit/7101444c77d2eb3352f45db437401ff0ded0e1a6)]:
  - @forinda/kickjs@5.13.0
  - @forinda/kickjs-db@5.9.1

## 5.8.7

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

- Updated dependencies [[`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8)]:
  - @forinda/kickjs@5.12.1
  - @forinda/kickjs-db@5.9.1

## 5.8.6

### Patch Changes

- Updated dependencies [[`462681b`](https://github.com/forinda/kick-js/commit/462681bd4254f93046f59fe187518f2b86b0e94a)]:
  - @forinda/kickjs@5.12.0
  - @forinda/kickjs-db@5.9.0

## 5.8.5

### Patch Changes

- [#265](https://github.com/forinda/kick-js/pull/265) [`187eb0b`](https://github.com/forinda/kick-js/commit/187eb0b2ce93b56dcccdc68febab95ed600c0ae4) Thanks [@forinda](https://github.com/forinda)! - refactor(logger): drop pino dependency, default to `ConsoleLoggerProvider`

  `@forinda/kickjs` no longer ships pino or pino-pretty. The default logger is now `ConsoleLoggerProvider`, which routes through `console.*` and has zero runtime dependencies. The pluggable `LoggerProvider` interface is unchanged — adopters who want pino, winston, bunyan, or anything else implement the same five-method contract and call `Logger.setProvider()` before `bootstrap()`. See `docs/guide/logging.md` for Pino, Winston, and silent-logger recipes.

  **Behavioural change for adopters relying on the default**: log lines lose pino's JSON envelope and `pino-pretty` colors. The new format is `[ComponentName] message`. If you depend on pino's output shape (structured fields, transports, log-aggregator-friendly JSON), copy the ~15-line PinoProvider snippet from `docs/guide/logging.md` and call `Logger.setProvider(new PinoProvider())` at startup.

  **Removed exports**: the `rootLogger` re-export from `@forinda/kickjs` and the `PinoLoggerProvider` class. The `LoggerProvider` interface, `ConsoleLoggerProvider`, `Logger`, and `createLogger` are unchanged.

  **CLI scaffolds**: `kick new` no longer pre-installs `pino` / `pino-pretty`, and the generated `vite.config.ts` no longer needs `ssr.external: ['pino', 'pino-pretty']`. Existing projects keep working without changes.

- Updated dependencies [[`187eb0b`](https://github.com/forinda/kick-js/commit/187eb0b2ce93b56dcccdc68febab95ed600c0ae4)]:
  - @forinda/kickjs@5.11.0
  - @forinda/kickjs-db@5.9.0

## 5.8.4

### Patch Changes

- Updated dependencies [[`e53f833`](https://github.com/forinda/kick-js/commit/e53f83358304fddfd10840a9f5a1ab603f184a2f), [`fbe82c5`](https://github.com/forinda/kick-js/commit/fbe82c53082ae0c507b8e8ec85cd1fdbecb0e660)]:
  - @forinda/kickjs@5.10.0
  - @forinda/kickjs-db@5.9.0

## 5.8.3

### Patch Changes

- Updated dependencies [[`33e151b`](https://github.com/forinda/kick-js/commit/33e151b5cc9847254e91193edc05961aa0f7c931)]:
  - @forinda/kickjs@5.9.2
  - @forinda/kickjs-db@5.9.0

## 5.8.2

### Patch Changes

- [#258](https://github.com/forinda/kick-js/pull/258) [`0aa5c29`](https://github.com/forinda/kick-js/commit/0aa5c29c3a9bf9ce67d111ad3db1a6430253a8d8) Thanks [@forinda](https://github.com/forinda)! - fix(cli): `kick new` now emits the `.agents/` subfolder layout (was leaking the legacy flat layout)

  `kick g agents` was restructured to emit `CLAUDE.md` at the project root plus `.agents/AGENTS.md` / `.agents/GEMINI.md` / `.agents/COPILOT.md` and per-skill `.agents/skills/<slug>/SKILL.md` files, but `kick new`'s project initializer had its own emission path that was never updated — so a freshly scaffolded project came out with the legacy flat layout (`AGENTS.md` + `kickjs-skills.md` at the project root) regardless of the framework version. Two paths drifted; both should produce the same shape.

  The fix is one line: `initProject()` now delegates to `generateAgentDocs({ only: 'all', force: true })` instead of writing the three legacy files directly. The legacy `generateKickJsSkills` (deprecated since the per-skill split) is no longer called from the new-project path.

  Regression test in `kick-new-yes.test.ts`: spawn `kick new` and assert no `AGENTS.md` / `kickjs-skills.md` at the project root; assert `.agents/AGENTS.md` / `GEMINI.md` / `COPILOT.md` exist; assert at least one `.agents/skills/<slug>/SKILL.md` (covers the per-skill format).

  No CLI flag or option changes; the `kick new` surface is unchanged from the adopter's side. The fix only affects which files land where.

## 5.8.1

### Patch Changes

- [#254](https://github.com/forinda/kick-js/pull/254) [`d4bc212`](https://github.com/forinda/kick-js/commit/d4bc21292dedbb20ee1a952a43422a09afaf35fb) Thanks [@forinda](https://github.com/forinda)! - docs: README sweep — drop v4 references, switch examples to defineModule + factory shape, fix dead links

  Documentation-only patch bump so the updated READMEs ship to the npm-displayed package pages (npm always includes README.md in the tarball regardless of `files` field). No code or wire-format changes; safe to consume without changes.

  **`@forinda/kickjs`** — full rewrite of the README's getting-started. Was 60 lines using a `class implements AppModule` example with a deprecated `buildRoutes` import. Now walks through service → controller → module → registry → bootstrap in canonical v5 factory shape, with Zod validation, typed `Ctx<KickRoutes…>`, project-layout overview, and pointers to every relevant guide page.

  **`@forinda/kickjs-cli`** — add `bun` to the `--pm` flag list (the CLI's `kick new` prompt supports bun; the README was missing it).

  **`@forinda/kickjs-vite`** — fix dead doc link (`guide/vite-plugin` → `guide/hmr`; no `vite-plugin.md` exists, the HMR guide covers the plugin surface).

  **`@forinda/kickjs-auth`** — replace `kick add auth` install with `pnpm add @forinda/kickjs-auth`. The package was removed from the `kick add` registry; existing adopters who still depend on it install manually now, and the README points at the BYO Auth recipe for the canonical path forward.

  **`@forinda/kickjs-queue`** — list provider variants in the install section (`kick add queue:bullmq | rabbitmq | kafka | redis-pubsub`). README previously only mentioned BullMQ even though three other providers ship in the package.

  **`@forinda/kickjs-lint`** — scrub the stale v3 → v4 migration link suffix; point at the current DI Tokens guide instead.

  **`kickjs-devtools` (VS Code extension)** — disambiguate the naming collision with `@forinda/kickjs-devtools` (the runtime adapter that serves `/_debug/*`). Adds an explicit "VS Code editor extension, not the runtime adapter" callout, and recommends setting `secret: env.DEVTOOLS_SECRET` on the adapter for production gating.

  Root repo `README.md` is also rewritten (drop v4.2 banner, remove "Deprecated — going private in v5" table for packages already gone, switch Hello World to factory patterns, drop `kick g resolver` and `kick add auth` references, update `kick g agents` description to `.agents/` subfolder layout) — but that file isn't published, so it's a free-rider on this changeset.

- Updated dependencies [[`d4bc212`](https://github.com/forinda/kick-js/commit/d4bc21292dedbb20ee1a952a43422a09afaf35fb)]:
  - @forinda/kickjs@5.9.1
  - @forinda/kickjs-db@5.9.0

## 5.8.0

### Minor Changes

- [#250](https://github.com/forinda/kick-js/pull/250) [`1eed906`](https://github.com/forinda/kick-js/commit/1eed9066096cad9218ee4dcfd24f75adc7205b42) Thanks [@forinda](https://github.com/forinda)! - feat(cli): propagate `projectRoot` through `GeneratorContext` and `KickCliPluginContext`

  Both CLI contexts now carry a resolved `projectRoot` field alongside the existing `cwd`. Plugin authors and generator authors no longer need to call `findProjectRoot(cwd)` themselves to find the directory that owns `kick.config.*` — the value is resolved once at CLI startup and threaded through.

  **`GeneratorContext` (`packages/cli/src/generator-extension/define.ts`)**

  ```ts
  export interface GeneratorContext {
    // ...existing fields
    cwd: string // where the CLI was invoked
    projectRoot: string // resolved root via findProjectRoot()
  }
  ```

  `buildGeneratorContext` now accepts an optional `projectRoot`. When omitted it derives one from `cwd` via `findProjectRoot()` — zero-config for ad-hoc callers, free for the CLI entry which already resolved it.

  **`KickCliPluginContext` (`packages/cli/src/plugin/types.ts`)**

  ```ts
  export interface KickCliPluginContext {
    cwd: string // invocation directory
    projectRoot: string // resolved root
    config: KickConfig | null
    log: (msg: string) => void
    generators?: DiscoveredGenerator[]
  }
  ```

  `mergeCliPlugins.register()` now populates `projectRoot` automatically:

  - When the caller supplies a ctx, that field wins (test harnesses can inject a different workspace boundary).
  - When no ctx is supplied (lightweight test path), the default is `findProjectRoot(process.cwd())`.

  **Dispatch threading**

  `tryDispatchPluginGenerator` accepts a `projectRoot` field in `DispatchInput` so both the bare-action dispatch and `kick g <subcommand>` Commander dispatch propagate the resolved root from `cli.ts` down to plugin generator `files()` factories.

  **Why both contexts?**

  `cwd` and `projectRoot` are semantically distinct:

  - `cwd` = where the adopter typed the command (could be any subdirectory)
  - `projectRoot` = the resolved base that owns `kick.config.*` (or `package.json` as fallback)

  Generators that emit "files relative to the project" should now use `ctx.projectRoot` instead of `ctx.cwd`. Existing code that treats `ctx.cwd` as the project root keeps working — the CLI entry point sets `cwd` to the resolved root for back-compat, so the two fields hold the same value at the top of the chain.

  **Tests**

  - `buildGeneratorContext`: caller-supplied `projectRoot` wins; derived from `cwd` via `findProjectRoot()` when omitted; falls back to `cwd` when no marker file exists anywhere.
  - `mergeCliPlugins`: caller `projectRoot` flows through to `ctx`; default ctx populates it from `process.cwd()`.

### Patch Changes

- Updated dependencies [[`9f1e90e`](https://github.com/forinda/kick-js/commit/9f1e90e00160dfb3801e8bac451ace0aa7b3f37f), [`652a6bf`](https://github.com/forinda/kick-js/commit/652a6bf0dbac1c4c288fc921bb2782f28c1207a4)]:
  - @forinda/kickjs@5.9.0
  - @forinda/kickjs-db@5.9.0

## 5.7.0

### Minor Changes

- [#248](https://github.com/forinda/kick-js/pull/248) [`021926e`](https://github.com/forinda/kick-js/commit/021926e88c993230c695e37361bcea7c9ac3e3ba) Thanks [@forinda](https://github.com/forinda)! - feat(cli): `.agents/` subfolder layout + standard SKILL.md format + doc-driven skill enrichment

  `kick g agents` now emits the agent-context files into a structured `.agents/` subfolder, with skills following the standard Claude Code / Copilot CLI per-skill `SKILL.md` format (one directory per skill with YAML frontmatter), and every skill body has been rewritten from the official guide pages to reflect concrete patterns + red flags + nuances.

  **New layout**

  ```
  CLAUDE.md                 # at root — Claude Code auto-loads from here (thin pointer to .agents/)
  .agents/
  ├── AGENTS.md             # canonical multi-agent reference
  ├── GEMINI.md             # Gemini CLI specific notes (NEW)
  ├── COPILOT.md            # Copilot CLI specific notes (NEW)
  └── skills/
      ├── add-module/SKILL.md
      ├── add-adapter/SKILL.md
      ├── add-plugin/SKILL.md                       # NEW
      ├── write-controller-test/SKILL.md
      ├── env-wiring-check/SKILL.md
      ├── bootstrap-export/SKILL.md
      ├── thin-entry-file/SKILL.md
      ├── context-contributor/SKILL.md
      ├── query-parsing-list-endpoint/SKILL.md      # NEW
      ├── use-asset-manager/SKILL.md                # NEW
      ├── cli-commands-cheatsheet/SKILL.md          # NEW
      ├── refresh-agent-docs/SKILL.md
      └── deny-list/SKILL.md
  ```

  Each `SKILL.md` opens with YAML frontmatter (`name: kickjs-<slug>`, `description: <when to use>`) so agents that auto-discover skills (Claude Code, Copilot CLI plugins, Gemini's `activate_skill`) pick each up without an external index file.

  **New API surface**

  - `defineGemini` / `defineCopilot` template helpers exported from `@forinda/kickjs-cli` (alongside the existing `generateAgents` / `generateClaude`).
  - `generateKickJsSkillFiles(name, template, pm): KickJsSkillFile[]` replaces the legacy single-file `generateKickJsSkills` (kept as `@deprecated` for one minor for back-compat).
  - New `--only gemini` and `--only copilot` flags on `kick g agents` for targeted refreshes.
  - New `findProjectRoot()` export — implicit, since `agent-docs.ts` uses it for cwd resolution, but the rest of the CLI was already using it.

  **Migration behaviour**

  When `kick g agents` runs against an existing project, root-level `AGENTS.md` / `kickjs-skills.md` are **left untouched**. The new layout emits alongside — adopters delete the legacy files manually when they're ready. `CLAUDE.md` at the root is rewritten to point at `.agents/` paths.

  **Enriched skill content**

  Each of the 13 skill bodies has been rewritten to faithfully reflect the official docs:

  - **`add-module`** — `defineModule` factory, `import.meta.glob` requirement, versioned route arrays, conditional `setup(registry)` mounting, factory-invocation footgun.
  - **`add-adapter`** — `defineAdapter` factory, lifecycle hook decision tree (`beforeMount` / `beforeStart` / `afterStart` / `shutdown`), middleware phases, `.scoped` / `.async` patterns, `dependsOn` topo-sort, when to promote to a plugin.
  - **`add-plugin`** _(NEW)_ — `definePlugin` factory, inline-literal pattern for one-off DI bindings, execution order, multi-instance, when plugin > adapter.
  - **`write-controller-test`** — `Container.reset()` in `beforeEach`, typed `Ctx<KickRoutes...>`, `Scope.REQUEST` × singleton incompatibility.
  - **`env-wiring-check`** — side-effect import requirement, `reloadEnv` vs `resetEnvCache`, sticky cache, `@Value` `process.env` fallback that masks bugs.
  - **`bootstrap-export`** — Vite HMR + `createTestApp` consequences of missing `export const app`.
  - **`thin-entry-file`** — category-folder split, three middleware signatures (raw Express / `(ctx, next)` / adapter Express again), inline-plugin DI binding pattern.
  - **`context-contributor`** — `defineHttpContextDecorator` + DI `deps` + `dependsOn` topo-sort + ALS three-instance model + error matrix + augmentation completeness.
  - **`query-parsing-list-endpoint`** _(NEW)_ — `ctx.qs` + `ctx.paginate`, operator format, Drizzle column-ref config, allow-list security default.
  - **`use-asset-manager`** _(NEW)_ — `assets.<ns>.<key>()` typed Proxy, `@Asset` decorator, test fixture swap via `KICK_ASSETS_ROOT` + `clearAssetCache()`.
  - **`cli-commands-cheatsheet`** _(NEW)_ — top commands, useful flag combos, lesser-known high-value commands, common red flags.
  - **`refresh-agent-docs`** — updated for the `.agents/` layout.
  - **`deny-list`** — grew to enumerate every cross-skill anti-pattern in one place.

  **Tests** — `__tests__/agent-docs-layout.test.ts` covers the full layout: CLAUDE.md at root, all `.agents/` files emitted, ≥ 13 SKILL.md files with valid frontmatter, existing root-level files untouched, CLAUDE.md pointers correct, package-manager interpolation works.

## 5.6.0

### Minor Changes

- [#244](https://github.com/forinda/kick-js/pull/244) [`e85bf1d`](https://github.com/forinda/kick-js/commit/e85bf1d6b84aedaa803bd989f68f7e2715af9729) Thanks [@forinda](https://github.com/forinda)! - feat(cli): plugin generators register as Commander subcommands + `defineTypegen` helper

  Two related improvements to the CLI plugin authoring surface:

  **`defineTypegen` identity factory.** Mirrors the existing `defineGenerator` ergonomics — adopters can now write `defineTypegen({ id, inputs, generate })` and get full type inference on the `generate(ctx)` body without manually annotating `TypegenPlugin`. Exported alongside `defineGenerator` from `@forinda/kickjs-cli`.

  **Plugin generators surface in `kick g --help` and dispatch via Commander.** Previously, `KickCliPlugin.generators[]` entries were only discoverable through `kick g --list`, and a bare invocation like `kick g drizzle-typegen` (no item arg) silently fell through to the module generator — scaffolding a module called "drizzle-typegen" instead of running the plugin. Two changes fix this:

  1. `KickCliPluginContext` now carries the merged `generators[]` (threaded through by `mergeCliPlugins.register()`), so `register()` callbacks have access to plugin generators at command-registration time.
  2. The built-in `kick/generate` plugin now iterates over `ctx.generators` and registers each as a real Commander subcommand. The subcommand syntax honors the spec's first `args[]` entry (`<schema>` when required, `[schema]` when optional), and declared `flags[]` show up as `--flag` options. The bare-action dispatch is preserved as a safety net for late-discovered generators (e.g. package.json-resolved entries that didn't reach `mergeCliPlugins`).

  The previous `if (names.length >= 2)` gate in the bare action is gone — plugin generators dispatch via Commander whether the adopter passes 0, 1, or N positionals, with required-arg validation handled at the Commander layer.

- [#247](https://github.com/forinda/kick-js/pull/247) [`89f5737`](https://github.com/forinda/kick-js/commit/89f5737c1287233902dd666b3a3df70a64cc1bfc) Thanks [@forinda](https://github.com/forinda)! - chore(cli): drop @forinda/kickjs-auth from every user-facing CLI surface

  `@forinda/kickjs-auth` is no longer offered through the CLI. Adopters who already depend on it keep working — the package itself stays on disk and is unaffected. Only the prompts / scaffolds / registries that proactively suggested it have been pruned. Five surfaces touched:

  1. **`kick new` multi-select** — `Auth` removed from the optional-packages prompt (`init.ts`). New projects no longer see it offered.
  2. **`kick g auth-scaffold`** subcommand removed (`generate.ts`). The `kick g` Commander tree no longer registers the `auth-scaffold` subcommand. Underlying generator file (`generators/auth-scaffold.ts`) kept on disk for now — orphaned code, can be deleted in a follow-up.
  3. **`kick add auth`** registry entry removed (`commands/add.ts`). `kick add --list` no longer surfaces it.
  4. **`SIBLING_PACKAGES`** version-lookup list (`generators/project.ts`) — `@forinda/kickjs-auth` removed so `npm view <name> version` isn't queried at scaffold time for a package the CLI no longer offers.
  5. **`PACKAGE_DEPS`** alias map (`templates/project-config.ts`) — `auth` key removed.

  Imports cleaned up alongside: `generateAuthScaffold`, the local `AuthScaffoldOpts` interface, and the now-unused `select` / `promptConfirm` imports (the only callers were the removed auth-scaffold action).

  Documentation references in `project-docs.ts` template (recipes mentioning `@Public()`, `AuthAdapter`, `JwtStrategy`) intentionally kept — those are example prose, not CLI surfaces, and adopters who explicitly install `@forinda/kickjs-auth` still benefit from the recipes.

- [#241](https://github.com/forinda/kick-js/pull/241) [`36201d6`](https://github.com/forinda/kick-js/commit/36201d6e6ca6eeb19dee0f75817f45d2e5a05c83) Thanks [@forinda](https://github.com/forinda)! - feat(cli): load TypeScript configs with jiti + walk-up project root resolution

  `kick.config.ts` no longer needs `tsx` wrapping or a manual loader — the CLI now imports it through `jiti` directly. Previously, `loadKickConfig` did a bare `await import('kick.config.ts')` which throws `ERR_UNKNOWN_FILE_EXTENSION` on vanilla Node; the bare `catch` swallowed it and silently returned `null`, so adopters' `plugins[]`, `commands[]`, `modules{}`, and `typegen{}` blocks were all dropped without explanation. The new path uses `jiti` (already a transitive dep across the workspace), and the warning fires only when `jiti` itself can't be resolved.

  `loadKickConfig` and `kick typegen` now walk up from the invocation cwd to find `kick.config.*` (or `package.json` as a fallback). Running `kick typegen` from inside `src/` used to resolve `srcDir` and `outDir` against `src/`, producing `src/.kickjs/types/` instead of `<root>/.kickjs/types/`. The new `findProjectRoot()` helper (exported from `@forinda/kickjs-cli`) makes this deterministic: it returns the first ancestor with a `kick.config.*`, or — only as a fallback — the first ancestor with a `package.json`.

  Also drops a handful of stale `graphql` mentions: the CLI no longer advertises a `--template graphql` flag (never existed; valid set is `rest | ddd | cqrs | minimal`), the `kick g resolver` doc line and the GraphQLAdapter rows in the example `kick inspect` output were removed, and a stray comment in `resolve-out-dir.ts` was corrected. GraphQL remains documented as a BYO recipe via `defineAdapter()` / `definePlugin()` (`docs/guide/migration-v3-to-v4.md`) — that hasn't changed.

### Patch Changes

- [#246](https://github.com/forinda/kick-js/pull/246) [`a94780c`](https://github.com/forinda/kick-js/commit/a94780c26ceee6355c4680a5aeed36d83664a021) Thanks [@forinda](https://github.com/forinda)! - feat(http): widen AdapterMiddleware.path + tighten handler typing + clarify lifecycle docs

  Three improvements to the adapter middleware contract, surfacing from a real-world bug-report investigation that found no bug — just sharp edges:

  **1. Widened path scope.** `AdapterMiddleware.path` now accepts `string | RegExp | (string | RegExp)[]` (new `MiddlewarePath` type, exported from `@forinda/kickjs`) instead of a bare `string`. Mirrors Express's native `app.use(path, …)` shape so adopters get the full range without learning a new mini-language:

  ```ts
  middleware() {
    return [
      { handler: rateLimit(), phase: 'beforeRoutes', path: ['/api', '/admin'] },
      { handler: csrf(), phase: 'afterGlobal', path: /^\/api\/v\d+\//, },
      { handler: bodyLog({ region: 'eu' }), phase: 'afterGlobal', path: ['/api', /^\/internal\//] },
    ]
  }
  ```

  The framework copies readonly arrays before passing to Express (`PathParams` requires a mutable array), so adopters can declare paths with `as const` without any runtime workaround.

  **2. Tighter `handler` typing.** `AdapterMiddleware.handler` is now `RequestHandler | ErrorRequestHandler` instead of `any`. Adapters that ship error-handling middleware get type checking; the union resolves via Express's arity-based dispatch.

  **3. Lifecycle JSDoc clarified.** The `MiddlewarePhase` JSDoc spells out the `afterRoutes` semantics — fires **only on fall-through** (no route matched, or a handler called `next()` without ending the response). Controllers that respond with `ctx.json(…)` end the chain and skip this phase. For per-response work (logging, metrics) the doc points adopters at `res.on('finish', …)` from an earlier phase instead. The `kick g middleware` generator template now embeds the same guidance so freshly scaffolded middleware files explain phase trade-offs at the point of use.

  New tests in `__tests__/adapter-middleware-path-patterns.test.ts` exercise every path shape (string prefix, array of strings, single RegExp, mixed array, `as const` readonly array, omitted). The existing `lifecycle-mount-order.test.ts` continues to lock in the order semantics.

- Updated dependencies [[`a94780c`](https://github.com/forinda/kick-js/commit/a94780c26ceee6355c4680a5aeed36d83664a021), [`e0bf64b`](https://github.com/forinda/kick-js/commit/e0bf64b28e032bd2fee88ed397740430c7d74ae8), [`a583829`](https://github.com/forinda/kick-js/commit/a5838298632e419389e3464779b9cb2f049d4392)]:
  - @forinda/kickjs@5.8.0
  - @forinda/kickjs-db@5.9.0

## 5.5.1

### Patch Changes

- Updated dependencies [[`4286e9f`](https://github.com/forinda/kick-js/commit/4286e9f37d5645837fb4a5753ff2e2bb6f198298)]:
  - @forinda/kickjs@5.7.1
  - @forinda/kickjs-db@5.9.0

## 5.5.0

### Minor Changes

- [#236](https://github.com/forinda/kick-js/pull/236) [`a5e6a33`](https://github.com/forinda/kick-js/commit/a5e6a331af581d62022025e499ff496055a9f89a) Thanks [@forinda](https://github.com/forinda)! - fix: close the four DX rough edges from forinda/kick-js#235

  Bundles all four reported issues into one PR per the request. Each lands independently — the failing surface for one didn't depend on any other — but a stacked PR keeps the review and CHANGELOG entry coherent.

  ### §1 — `ContextDecoratorTarget` is now publicly exported

  Adopters wrapping `defineHttpContextDecorator(...)` in a public method-decorator factory hit `TS4058` under `declaration: true` builds because the inferred return type referenced an internal symbol. The interface was already exported from `core/context-decorator.ts`; it just wasn't re-exported from `core/index.ts`. One-line fix — adopters can now annotate their wrapper's return type as `ContextDecoratorTarget` instead of re-deriving the legacy `MethodDecorator` shape locally.

  ```ts
  import {
    defineHttpContextDecorator,
    type ContextDecoratorTarget,
  } from '@forinda/kickjs'

  const RequirePermissionContext = defineHttpContextDecorator<...>({...})

  export function RequirePermission(code: PermissionCode): ContextDecoratorTarget {
    return RequirePermissionContext({ permissionCode: code })
  }
  ```

  ### §2 — `@Autowired` and `@Inject` work in either position

  Both decorators now accept the property-decorator position AND the constructor-parameter-decorator position. Pick whichever name reads better at the call site:

  ```ts
  @Service()
  class UserRepo {
    // Property position — both names work.
    @Autowired(DB) private db1!: KickDbClient
    @Inject(DB) private db2!: KickDbClient

    // Constructor parameter position — both names work.
    constructor(
      @Autowired(LOGGER) private logger: Logger,
      @Inject(CACHE) private cache: Cache,
    ) {}
  }
  ```

  Runtime detects the position via the standard "third arg is a number" check (TypeScript's legacy parameter decorator signature) and routes to the correct metadata bucket (`AUTOWIRED` for properties keyed by prototype + name, `INJECT` for params keyed by constructor + index). The pre-existing no-token reflection-based forms (`@Autowired() private foo!: SomeClass` and `@Inject(SomeClass) foo`) keep working unchanged — `design:type` / `design:paramtypes` fallback still fires when token is undefined.

  7 new unit cases in `packages/kickjs/__tests__/inject-autowired-positions.test.ts` lock the matrix.

  ### §3 — mount-prefix `:params` propagate into `ctx.params` types

  Controllers mounted under a path with parameters (e.g. `/control/orgs/:id/extensions`) no longer need `params: orgIdParamsSchema` repeated on every route to type `ctx.params.id`. The typegen scanner now extracts each module's `routes()` body for `{ path, controller }` pairs and combines the mount path with the per-route path before extracting `:params`. Per-route `params: schema` declarations still override (schema wins over the URL-pattern fallback, as before).

  Multi-mount controllers (rare, e.g. v1 + v2 versioned variants) take the first mount's prefix; the per-route `params: schema` escape hatch handles asymmetric cases.

  6 new unit cases in `packages/cli/__tests__/scanner-mount-path-params.test.ts`.

  ### §4 — typegen warns when a decorated file isn't picked up by any module glob

  The default module template generates `import.meta.glob([patterns])` to side-effect-register decorated classes. Adopters who add a new file type (e.g. `context-decorators/*.ts`) and forget to extend the glob got silent registration drift — the decorator never fires, downstream hits a confusing `MissingContributorError` at request time.

  The typegen scanner now extracts every module file's globs, matches each decorated class file in the module subtree against them, and emits a `console.warn` for orphans:

  ```text
    kick typegen: 1 decorated class(es) not matched by any module's import.meta.glob():
      @Service RequireExtensionEnabled (src/modules/ext/context-decorators/require-extension.ts)
        → not picked up by any glob in src/modules/ext/ext.module.ts
  ```

  Surfaced at every `kick typegen` (and `kick dev` pre-typecheck) run. Doesn't fail the build — adopters who deliberately exclude files keep working — but the orphan is impossible to miss.

  9 new unit cases across `packages/cli/__tests__/scanner-orphaned-classes.test.ts` lock the glob-to-regex translator (`**/` → `(?:.+/)?`, `*` → `[^/]*`, `?` → `.`, negation patterns subtract) and `fileMatchesAnyGlob` semantics.

  ### Numbers

  | Package               | Before    | After           |
  | --------------------- | --------- | --------------- |
  | `@forinda/kickjs`     | 408 tests | 415 tests (+7)  |
  | `@forinda/kickjs-cli` | 276 tests | 291 tests (+15) |

  Minor bumps — all changes additive. Both `@Autowired`/`@Inject` working in either position is a behaviour widening (previously rejected positions now accept) so technically minor; the rest are additive surface (`ContextDecoratorTarget` export, new typegen warning) or scanner internals.

### Patch Changes

- Updated dependencies [[`a5e6a33`](https://github.com/forinda/kick-js/commit/a5e6a331af581d62022025e499ff496055a9f89a)]:
  - @forinda/kickjs@5.7.0
  - @forinda/kickjs-db@5.9.0

## 5.4.7

### Patch Changes

- Updated dependencies [[`c42c33a`](https://github.com/forinda/kick-js/commit/c42c33aac8a40b18bcb7a2e71cba75f5acf21137)]:
  - @forinda/kickjs-db@5.9.0

## 5.4.6

### Patch Changes

- Updated dependencies [[`707e6ba`](https://github.com/forinda/kick-js/commit/707e6ba741d1b25e79fdfd164463346a372c9745)]:
  - @forinda/kickjs-db@5.8.0

## 5.4.5

### Patch Changes

- Updated dependencies [[`ac74a73`](https://github.com/forinda/kick-js/commit/ac74a73e8c8c2e92565cf3f2b535045a23cce30d), [`eb06da2`](https://github.com/forinda/kick-js/commit/eb06da2eb397a68fd577dd0deb312187dcca49db), [`c695340`](https://github.com/forinda/kick-js/commit/c6953404b14ea9b0fc9f5ff0951849418c32d482), [`69a7126`](https://github.com/forinda/kick-js/commit/69a71269f60c1fb1b07bc687ed916da51ab086fa), [`7bc0d23`](https://github.com/forinda/kick-js/commit/7bc0d23084e1fcb8df346856dfb16bb5bd2f2f13)]:
  - @forinda/kickjs-db@5.7.0
  - @forinda/kickjs@5.6.0

## 5.4.4

### Patch Changes

- Updated dependencies [[`f9e24a5`](https://github.com/forinda/kick-js/commit/f9e24a591b1174f50deeec2567082f2194f77555)]:
  - @forinda/kickjs-db@5.6.0

## 5.4.3

### Patch Changes

- [#200](https://github.com/forinda/kick-js/pull/200) [`3dbdd06`](https://github.com/forinda/kick-js/commit/3dbdd06ba8dcf207d5bd4a5dc595c2d3e529182f) Thanks [@forinda](https://github.com/forinda)! - feat(db): refuse `pgEnum` value removal when a composite type references the enum (M4.C)

  The M3.B rename-recreate dance assumes the enum is referenced only by table columns. PG composite types / arrays-of-composite / domains containing the enum break that approach — the `ALTER COLUMN TYPE … USING column::text::foo` clause can't reach into composite fields, so the migration would fail opaquely at apply time.

  Generate-time gate added: when `kick db generate` produces one or more `removeEnumValue` changes, the CLI queries `pg_type` + `pg_attribute` against the configured PG connection. If any composite type holds the enum (directly or as an array element), it refuses to write the migration with a new `CompositeEnumReferenceError` listing every offending `<composite>.<attribute>`.

  The check runs only on the built-in pgAdapter path (`dialect: 'postgres'` + `connectionString`/`DATABASE_URL`). Adopters using the `db.adapter` factory escape hatch get the helper exported from `@forinda/kickjs-db` (`detectCompositeReferences`, `CompositeQueryRunner`, `CompositeRef`) so they can wire it themselves.

  No behavior change when no composite references the enum; no behavior change for non-PG dialects.

- Updated dependencies [[`3dbdd06`](https://github.com/forinda/kick-js/commit/3dbdd06ba8dcf207d5bd4a5dc595c2d3e529182f)]:
  - @forinda/kickjs-db@5.5.0

## 5.4.2

### Patch Changes

- [#198](https://github.com/forinda/kick-js/pull/198) [`8641275`](https://github.com/forinda/kick-js/commit/864127567a836d47c8c125a8ab77b3c2a1acd5f5) Thanks [@forinda](https://github.com/forinda)! - Fix duplicate `KickAssets` augmentation in `.kickjs/types/`.

  The legacy generator kept emitting `assets.d.ts` after the `kick/assets`
  typegen plugin carved out (M2.B-T8), so adopters got two declarations of
  `interface KickAssets` — one in `assets.d.ts`, one in `kick__assets.d.ts`.
  TypeScript merged them silently, but the next field rename or removal
  would surface as TS2717. The plugin is now the sole owner of the
  augmentation.

  `kick typegen` (and `kick dev`'s typegen pass) now sweep stale
  top-level files in `.kickjs/types/` against the union of generator +
  plugin outputs, so projects upgrading from older CLI versions self-heal
  the orphaned `env.ts` / `routes.ts` / `assets.d.ts` from the M2.B-T8
  carve in one run. The output dir is fully owned by typegen (writes its
  own `.gitignore`), so this is non-destructive.

  `index.d.ts` now omits the `import './kick__assets'` side-effect line
  when the project has no `assetMap` entries — the plugin skips emission
  in that case, so importing it would dangle.

## 5.4.1

### Patch Changes

- [#196](https://github.com/forinda/kick-js/pull/196) [`68455f6`](https://github.com/forinda/kick-js/commit/68455f62f45fb83caf72ba5c2a6273c6189114a1) Thanks [@forinda](https://github.com/forinda)! - Three codegen bugs adopters hit on fresh `kick new` projects:

  ## 1. `kick g module` now extends the `defineModules()` chain

  The orchestrator's array-insertion regex only matched flat `[...]` literals. Adopters whose `src/modules/index.ts` used `defineModules().mount(...)` saw new modules' import lines added but the `.mount(NewModule())` call missing — the new module silently never registered.

  Fix: depth-aware scanner detects both shapes. Flat array stays on the existing path; fluent chain gets a balanced-paren walker that handles nested factory calls (`mount(UserModule())`) without the inner parens confusing the boundary.

  ## 2. New projects default to `defineModules()`

  `kick new` and `kick g module` (on a fresh project) now emit:

  ```ts
  import { defineModules } from '@forinda/kickjs'
  import { HelloModule } from './hello/hello.module'

  export const modules = defineModules().mount(HelloModule())
  ```

  instead of the flat `[HelloModule()]` array. Subsequent `kick g module <name>` invocations append `.mount(<Name>Module())` to the chain. Pinning `modules.style: 'class'` in `kick.config.ts` keeps the legacy flat-array form for adopters who prefer it.

  ## 3. `kick new` resolves each `@forinda/kickjs-*` package's actual published version

  Previously `kick new` pinned every kickjs sibling to the CLI's own version (`^5.4.0` for everything). After per-package independent versioning landed, that under-installs adopters whenever a sibling bumps independently — `@forinda/kickjs@5.5.0` may pair with `@forinda/kickjs-cli@5.4.2` and `@forinda/kickjs-swagger@5.3.1`.

  Fix: `kick new` now runs `npm view <name> version` in parallel for every sibling at scaffold time and pins each dep to its own latest. `npm view` failure (offline / unpublished) falls back to the CLI version so the scaffold stays usable.

  Bonus: scaffolded `package.json` now starts at `version: '0.0.0'` instead of inheriting the CLI version. Old behaviour produced apps tagged `5.4.0` on day one, breaking adopters' first npm publish.

  ## 4. Drop `buildRoutes()` mechanics from generated `routes()` JSDoc

  The generated `routes()` JSDoc (DDD / REST / CQRS / scaffold) lectured adopters on how the framework derives the Express Router from the controller via `buildRoutes()` — implementation detail, not API documentation. Replaced with a focused breakdown of the **return value shape**: `path` / `controller` / `version` (with the array-form example for multi-route mounting kept).

  ## 5. Generated agent docs (`CLAUDE.md` / `AGENTS.md` / `kickjs-skills.md`) cover the new module API

  The agent-prompt files emitted by `kick new` now describe `defineModule({...})` + `defineModules().mount(...)` as the default module shape, name `kick.config.ts > modules.style: 'define' | 'class'` as the toggle, and point at `kick codemod modules --experimental --apply` for migrating between the two forms. Cheat-sheet rows updated, registry-array snippets switched to the fluent chain (with the class-form alternative kept as the legacy comment), `AppModule` interface row reframed as legacy.

  ## Tests

  257 → 257 (1 existing test updated to match the new `defineModules()` default; 1 new regression test for chain-append on fluent-form registries). Build + typecheck clean.

## 5.4.0

### Minor Changes

- [#193](https://github.com/forinda/kick-js/pull/193) [`d9918be`](https://github.com/forinda/kick-js/commit/d9918be943f976e758723e2da89348334e921903) Thanks [@forinda](https://github.com/forinda)! - `modules.style` config flag + `kick codemod modules` migration command + style-drift gate on `kick g module`.

  ## What's new

  ### Config flag — `kick.config.ts > modules.style: 'define' | 'class'`

  ```ts
  export default defineConfig({
    modules: {
      style: 'class', // pin to legacy class form; default is 'define'
    },
  })
  ```

  The framework runtime accepts both shapes regardless of this setting — `Application` discriminates `typeof entry === 'function'` at boot. The flag controls codegen output only:

  | Style                | Module file                                     | Modules registry |
  | -------------------- | ----------------------------------------------- | ---------------- |
  | `'define'` (default) | `defineModule({ name, build: () => ({...}) })`  | `[TaskModule()]` |
  | `'class'`            | `class TaskModule implements AppModule { ... }` | `[TaskModule]`   |

  `kick rm module` matches both forms, so flipping the flag mid-project doesn't break un-registration.

  ### `kick codemod modules` — bidirectional migration

  Experimental command that rewrites between the two shapes. **Direction defaults to `modules.style`** from kick.config (or `'define'` when unset), so `kick codemod modules` "just does the right thing" for the project.

  ```bash
  # Default direction = modules.style from kick.config
  kick codemod modules --experimental                 # dry-run preview
  kick codemod modules --experimental --apply         # write changes

  # Override direction explicitly
  kick codemod modules --experimental --apply --target class
  ```

  - **Backup before rewrite** — `--apply` writes a timestamped snapshot to `.kickjs/codemod-backups/<iso-stamp>-modules/` before touching any module file. Adopters not tracking with git can revert with `rm -rf <modulesDir> && mv "<backup>" <modulesDir>`. Skip with `--no-backup`.
  - **Idempotent** — re-running on already-migrated code is a no-op (returns `'already in target form'` per file).
  - **Both module file conventions** — picks up `<modulesDir>/<sub>/<name>.module.ts` (current) AND `<modulesDir>/<sub>/index.ts` (legacy).
  - **Conservative** — files with multiple module classes, decorators on the class, or unrecognized method signatures are reported as `skipped` with a reason and left untouched.

  ### Style-drift gate on `kick g module`

  When `style: 'define'` resolves AND the project still has class-form modules, `kick g module` refuses with an actionable error pointing at `kick codemod modules`:

  ```text
  Error: 1 module file(s) still use the legacy `class … implements AppModule` shape.
    Project setting: modules.style: 'define' (default)

    Files needing migration:
      - src/modules/users/user.module.ts

    Pick one:
      1. Migrate everything to defineModule:
         $ kick codemod modules --experimental --apply
      2. Keep the class form — pin it in kick.config.ts:
         // kick.config.ts
         export default defineConfig({ modules: { style: 'class' } })
  ```

  The gate runs only for `'define'`; `'class'` projects accept either shape since defineModule modules pass through Application's class-vs-instance discriminator at boot.

  ## What changed
  - New `packages/cli/src/generators/migrate-modules.ts` — bidirectional class ↔ defineModule rewriter, registry rewriter (`AppModuleClass[]` ↔ `AppModuleEntry[]` + factory-call vs bare-reference), file walker that handles both `*.module.ts` and legacy `<sub>/index.ts` patterns, backup helper.
  - New `packages/cli/src/commands/codemod.ts` — `kick codemod` namespace (distinct from `kick db migrate`).
  - `kick g module` orchestrator gates on style drift before generating.
  - All four pattern generators (DDD/REST/CQRS/minimal) + scaffold template branch on the resolved style.
  - `kick rm module` + `kick g scaffold` register-loader emit the matching shape.

  ## Tests
  - 11 new unit tests for the migrator: class→define, define→class, idempotency, register-less modules, multi-class refusal, registry rewrites both directions, `index.ts` detection, backup behavior (creates timestamped dir, dry-run skips, --no-backup skips).
  - 3 new integration tests on the gate: default style refuses on legacy modules; style='class' proceeds without checks; style='class' emits class form.

  Suite: 231 → 253 (+22). Build + typecheck clean.

  ## Docs

  `docs/guide/generators.md` "Module declaration style" section covers the flag's effect on codegen output. The `kick codemod modules` command surface lives in the command's `--help` output for now.

- [#191](https://github.com/forinda/kick-js/pull/191) [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077) Thanks [@forinda](https://github.com/forinda)! - `defineModule()` factory + simplified `routes()` shape — the fourth `define*` primitive lands and the codegen + docs sweep follows.

  ## `defineModule()` — new factory

  Mirrors `defineAdapter` / `definePlugin` / `defineContextDecorator` so adopters learn one mental model across all four primitives. The legacy `class FooModule implements AppModule { ... }` form keeps working — `bootstrap` accepts either shape and the loader discriminates at boot.

  ```ts
  const TasksModule = defineModule({
    name: 'TasksModule',
    defaults: { scope: 'public' },
    build: (config, { name }) => ({
      register(container) {
        container.registerInstance(`tasks:scope:${name}`, config.scope)
      },
      routes() {
        return { path: `/${config.scope}/tasks`, controller: TasksController }
      },
      contributors() {
        return [LoadTenant.registration]
      },
    }),
  })

  bootstrap({
    modules: [
      TasksModule(), // public scope (defaults)
      TasksModule.scoped('admin', { scope: 'admin' }), // namespaced clone
    ],
  })
  ```

  - `(config?)` call form returns the module instance.
  - `.scoped(scopeName, config?)` returns a namespaced instance (build-context name becomes `${moduleName}:${scope}`).
  - `.definition` exposes the frozen options snapshot for tooling.

  `.async()` is intentionally **not** part of the surface. Module config has no async-resolution window: `register()` and `routes()` both run synchronously during bootstrap, before any adapter `beforeStart` hook fires. Adopters who need async-resolved config push it into an adapter and inject the resolved value into the module via DI tokens.

  Boot-time validation: missing `name`, missing `build`, non-function `build`, non-object options all throw `TypeError` immediately (typically module-load) so adopters get a clear error before bootstrap.

  ## `AppModuleEntry` union type

  `bootstrap({ modules })`, `KickPlugin.modules?()`, and `createTestApp({ modules })` now accept `AppModuleEntry = AppModuleClass | AppModule` so `defineModule`-output instances and legacy classes mix freely in the same array. The Application loader discriminates `typeof entry === 'function'` to dispatch — classes get `new`-ed, instances are used directly.

  ## `defineModules()` — fluent module-list builder

  ```ts
  import { bootstrap, defineModules } from '@forinda/kickjs'

  const modules = defineModules().mount(HelloModule()).mount(TasksModule()).mount(AdminModule())

  await bootstrap({ modules })
  ```

  `defineModules()` returns a `ModuleList` (an `AppModuleEntry[]` subclass with a chainable `.mount()`). Drops into `bootstrap({ modules })` directly — no unwrap step — because `ModuleList extends Array<AppModuleEntry>`. Optional vararg seeds the list inline: `defineModules(HelloModule()).mount(TasksModule())` composes the two forms naturally.

  The plain `[X(), Y()]` array form keeps working — `defineModules()` is the fluent alternative for adopters who prefer the call-then-call pattern that mirrors `definePlugin().scoped(...)` / `defineAdapter()` elsewhere in the framework. Both produce the same shape internally.

  ## `ModuleRoutes` simplified — `controller` alone is sufficient

  ```ts
  // Before
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }

  // After
  routes() {
    return {
      path: '/users',
      controller: UserController,  // framework derives router via buildRoutes() internally
    }
  }
  ```

  The `router` field is now optional — when omitted, the framework calls `buildRoutes(controller)` itself. `controller` was already required for OpenAPI introspection via `SwaggerAdapter`, so the simplification removes the redundant `router: buildRoutes(...)` boilerplate without losing capability. Adopters who hand-build a router (composing multiple controllers, mounting third-party routers) keep passing `router` directly — both shapes are supported.

  Existing modules that still pass `router: buildRoutes(...)` keep working untouched. The new shape just removes the boilerplate going forward.

  ## CLI codegen sweep — `@forinda/kickjs-cli`

  Every module template (`generateModuleIndex` DDD, `generateRestModuleIndex`, `generateMinimalModuleIndex`, `cqrs.ts`'s `generateCqrsModuleIndex`, `scaffold.ts`'s `genModuleIndex`, `project-app.ts`'s `generateHelloModule`) now emits the `defineModule({ name, build })` form with the simplified `{ path, controller }` route shape.

  Each generated `routes()` carries a JSDoc hint demonstrating the array-return + per-entry `version` override so adopters discover that surface from the generated file, not from a separate doc:

  ```ts
  /**
   * Return an array to mount multiple route sets — each entry can
   * override the API version with a `version` field — the mount path
   * becomes `/{apiPrefix}/v{version}{path}`:
   *
   *   return [
   *     { path: '/tasks', version: 1, controller: TasksV1Controller },
   *     { path: '/tasks', version: 2, controller: TasksV2Controller },
   *   ]
   */
  ```

  The `kick g module` orchestrator updates `src/modules/index.ts` to insert the factory-call form (`TasksModule()`) — the type annotation switches from `AppModuleClass[]` to `AppModuleEntry[]`. The `kick rm module` regex updated to match both `Module` and `Module()` forms.

  The `definePlugin` generator's `modules()` return type updated to `AppModuleEntry[]` with a comment explaining that both class and factory forms work.

  The `kick g scaffold` command now refuses with an actionable message when the project pattern isn't `'ddd'` — the field-based scaffold templates only support the DDD layout today, so non-DDD projects need to use `kick g module` until the scaffold variants land.

  ## `@forinda/kickjs-testing`

  `CreateTestAppOptions.modules` switches to `AppModuleEntry[]` so test apps accept both shapes. The isolated-container path inside `createTestApp` discriminates class vs instance the same way Application does — classes get `new`-ed, factory output is used directly. `KickPlugin.modules()` typing in the test-plugin harness updated in lockstep.

  ## Docs sweep

  Active adopter-facing guides updated: `docs/guide/modules.md` (full rewrite leading with `defineModule`), `getting-started.md`, `project-structure.md` (canonical examples). `plugins.md`, `migration-from-express.md`, `testing.md`, `generators.md`, `tutorial-hmr-decorators.md`, `tutorial-generator-patterns.md` get the type-annotation rename so the `AppModuleEntry[]` story is consistent across the docs site. Versioned snapshots under `docs/versions/` left untouched (they're locked to their respective releases).

  ## What's deferred
  - `kick g scaffold` for REST / CQRS / minimal patterns — currently only emits DDD-shaped layouts. The command refuses on non-DDD projects with a clear error pointing at `kick g module` as the workaround.
  - Module-registry pattern for plugins (`.mount(module)` / `.use(module)` factory) — separate design conversation; the flat-array `modules?(): AppModuleEntry[]` is the stable shape for now.

### Patch Changes

- Updated dependencies [[`a812ad5`](https://github.com/forinda/kick-js/commit/a812ad5daa9c3acbe9583eec632a766dadafaea8), [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077), [`f5c91f5`](https://github.com/forinda/kick-js/commit/f5c91f53bb42af4ae42eb3fdec4b1d9f312ad1f0)]:
  - @forinda/kickjs@5.5.0
  - @forinda/kickjs-db@5.4.1

## 5.3.2

### Patch Changes

- Updated dependencies [[`8f9c153`](https://github.com/forinda/kick-js/commit/8f9c1533aa0d865b472f93fd02c174799d4767d8)]:
  - @forinda/kickjs-db@5.4.1

## 5.3.1

### Patch Changes

- Updated dependencies [[`c601090`](https://github.com/forinda/kick-js/commit/c60109029a59694da9478dd714cb9aea684765fe), [`6be566a`](https://github.com/forinda/kick-js/commit/6be566a636fe1bbdd3c0b6b56d048f34c2c759e0), [`64ff558`](https://github.com/forinda/kick-js/commit/64ff558a2f1cee096f040a93b44d8eb68cd73255)]:
  - @forinda/kickjs-db@5.4.0

## 5.3.0

### Minor Changes

- [#178](https://github.com/forinda/kick-js/pull/178) [`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca) Thanks [@forinda](https://github.com/forinda)! - Lossless removal of `pgEnum` values. Previously `kick db generate` emitted a multi-line `--` comment for value removals and the migration ran cleanly with **silent data loss** — the database kept the old value list. The next `kick db generate` cycle would surface the drift, but never the actual removal.

  After this release, removing a value from `pgEnum(...)` produces a real migration carrying the rename-recreate dance:

  ```sql
  -- KICK ENUM REMOVE
  -- enum: "task_priority"
  -- removed: 'unused', 'archived'
  -- columns: tasks.priority
  --
  -- This migration drops values from a PostgreSQL ENUM type. The
  -- runner refuses to apply it without the --confirm-enum-drop flag
  -- (or `confirmEnumDrop: true` in RunnerOptions). Inspect the
  -- column USING clauses below to confirm rows holding a removed
  -- value will fail loudly rather than silently coerce.

  BEGIN;
    ALTER TYPE "task_priority" RENAME TO "task_priority__old";
    CREATE TYPE "task_priority" AS ENUM ('critical', 'high', 'medium', 'low', 'none');
    ALTER TABLE "tasks"
      ALTER COLUMN "priority" TYPE "task_priority"
      USING "priority"::text::"task_priority";
    DROP TYPE "task_priority__old";
  COMMIT;
  ```

  The `-- KICK ENUM REMOVE` literal at the top is the runner's gate signal. `kick db migrate latest` (and `kick db migrate up`) now refuse to apply such migrations unless `--confirm-enum-drop` is passed (or `confirmEnumDrop: true` is set on `RunnerOptions` in adopter code). Without the flag, `MigrationEnumDropError` fires with the affected enums / values / columns _before any DB write_.

  The `USING column::text::foo` clause does the safety check: if any row holds a removed value, the cast fails and the whole transaction rolls back. Operators who need to map removed values to a replacement first must hand-roll a pre-migration that does the data update before generating the structural removal.

  **New public API on `@forinda/kickjs-db`:**

  - `RunnerOptions.confirmEnumDrop?: boolean` — opt-in flag for the runner.
  - `MigrationEnumDropError` — thrown by the gate; carries `id`, `enums`, `removed`, `columns`.
  - `parseEnumDropHeader(sql)` / `enforceEnumDropGate(id, sql, confirmEnumDrop)` / `EnumDropHeader` — exposed for adopters who run migrations through their own tooling and want the same gate semantics.
  - `RemoveEnumValue` change kind extended with `values: readonly string[]` + `affectedColumns: readonly { table: string; column: string }[]`. Adopters reading the diff output programmatically gain access to both the new value list and the column round-trip targets.

  **New CLI flag:** `kick db migrate latest --confirm-enum-drop` (and `kick db migrate up --confirm-enum-drop`). Down-direction commands (`down`, `rollback`) do **not** require the flag — reversing a value removal is `ALTER TYPE … ADD VALUE` per dropped value, which is always cheap.

  **Migration notes for adopters who hand-roll migrations:** none. Existing migrations without the header literal are unaffected. The runner gate is opt-in by header presence; ordinary migrations skip the parse entirely (substring check).

  Spec: `docs/db/spec-enum-value-removal.md`.

- [#178](https://github.com/forinda/kick-js/pull/178) [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6) Thanks [@forinda](https://github.com/forinda)! - The kick/db typegen plugin now emits a `KickDbRelationsRegister` augmentation alongside the existing `KickDbSchema` + `KickDbRegister`, so `db.query.X.findMany({ with })` call sites get typed `with` keys without a hand-rolled augmentation file.

  After upgrading + running `kick typegen` (or `kick dev`), `.kickjs/types/kick__db.d.ts` carries:

  ```ts
  declare module '@forinda/kickjs-db' {
    interface KickDbRegister {
      db: KickDbClient<KickDbSchema>
    }

    interface KickDbRelationsRegister {
      db: SchemaToRelationsRegister<typeof appSchema>
    }
  }
  ```

  `SchemaToRelationsRegister<S>` is a new public type-level helper exported from `@forinda/kickjs-db`. It walks the schema barrel for `relations()` declarations and folds them into the registry shape — keyed by source table, each entry mapping `relationName → { kind, target }` with the target shrunk to the literal table name. Adding or removing a relation in `src/db/schema/relations.ts` flows through to call-site type-checking automatically.

  **Type-only refactor on `relations()`:**

  `relations(source, builder)` and the `Helpers.one` / `Helpers.many` factories now preserve the source name and target literal at the type level. The runtime shape is unchanged and all existing call sites remain assignable to the prior less-specific signature; this is strictly a narrowing improvement that makes `SchemaToRelationsRegister<S>` derivable.

  Specifically:

  - `relations()` returns `RelationsDecl<TSourceName, TRelationsMap>` (was `RelationsDecl`).
  - `Helpers.one` returns `RelationOne<TTarget>` (was `RelationOne`).
  - `Helpers.many` returns `RelationMany<TTarget>` (was `RelationMany`).

  Adopters who match against the old return types via `extends RelationsDecl` keep working — both new generics default to the prior open shape.

  **Migration:** Adopters who hand-rolled `KickDbRelationsRegister` augmentations as a stop-gap (suggested in M3.A.5 docs) can delete those files once typegen runs. The auto-emitted shape matches what was hand-written.

### Patch Changes

- Updated dependencies [[`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca), [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6), [`0a63cfc`](https://github.com/forinda/kick-js/commit/0a63cfc90cdc02c94dbdd410ac5f46d1952c3d06), [`b98bcbe`](https://github.com/forinda/kick-js/commit/b98bcbe67ab3fd4bb33039831e3b87702a053919)]:
  - @forinda/kickjs-db@5.3.0

## 5.2.3

### Patch Changes

- Updated dependencies [[`937f514`](https://github.com/forinda/kick-js/commit/937f514d282111299298acabad931c0e7de5c8c7)]:
  - @forinda/kickjs@5.4.0
  - @forinda/kickjs-db@5.2.2

## 5.2.2

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`bc397ce`](https://github.com/forinda/kick-js/commit/bc397ce8c598087ef565f0e5e6cbbe88e1c6cc09) Thanks [@forinda](https://github.com/forinda)! - Token generator now emits PascalCase for the key segment so scaffolded
  `createToken<T>('<scope>/<Key>/<suffix>')` literals satisfy the §22.2
  convention regex out of the box (no `kick-lint` warning on fresh
  scaffolds).

  Before:

  ```ts
  export const USER_REPOSITORY = createToken<IUserRepository>('app/user/repository')
  ```

  After:

  ```ts
  export const USER_REPOSITORY = createToken<IUserRepository>('app/User/repository')
  ```

  Existing scaffolded code keeps working — token literals are arbitrary
  strings; only newly generated files are affected. Generated docs
  (`AGENTS.md`, `CLAUDE.md`, `README.md`) updated to reflect the
  PascalCase key convention.

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.

  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

- Updated dependencies [[`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e)]:
  - @forinda/kickjs@5.3.1
  - @forinda/kickjs-db@5.2.2

## 5.2.1

### Patch Changes

- Updated dependencies [[`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98), [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98)]:
  - @forinda/kickjs-db@5.2.1
  - @forinda/kickjs@5.3.0
