# @forinda/kickjs-client

## 0.1.1

### Patch Changes

- [#452](https://github.com/forinda/kick-js/pull/452) [`50e40e9`](https://github.com/forinda/kick-js/commit/50e40e9f491084b39e47b778aa5fec221c0e083e) Thanks [@forinda](https://github.com/forinda)! - feat: `kick new --template fullstack` — typed end-to-end workspace

  Scaffolds a pnpm workspace with `server/` (KickJS API) and `web/` (Vite +
  React) where the frontend is typed against the backend via
  `@forinda/kickjs-client` and the server's generated `KickRoutes.Api`:

  ```bash
  kick new my-app --template fullstack
  cd my-app && pnpm dev   # server (kick dev) + web (vite), proxied
  ```

  Rename a field in a server handler → the web app stops compiling.

  Also, found by proving the template end-to-end:

  - `@forinda/kickjs-client`: package exports pointed at `dist/index.mjs` /
    `.d.mts` but the build emits `index.js` / `.d.ts` — the published entry was
    unresolvable; fixed
  - `@forinda/kickjs-client`: the generated `KickRoutes.Api` is an interface
    (no index signature) and failed the client's `Record` constraint — the
    generic now accepts it
  - the scaffolded hello controller uses return-value handlers, so its response
    types flow into the typed client out of the box

## 0.1.0

### Minor Changes

- [#447](https://github.com/forinda/kick-js/pull/447) [`7085e3d`](https://github.com/forinda/kick-js/commit/7085e3d2909dd299c16d6cc0994b60a001d2e9e8) Thanks [@forinda](https://github.com/forinda)! - feat: typed query strings + `createTestClient`

  - Routes with a statically-known query shape (Zod `query` schema or
    `@ApiQueryParams`) now constrain `query` at the call site — sort fields
    autocomplete (`'-createdAt' | 'createdAt' | …`), typos are compile errors.
    Routes without one keep the loose record type.
  - `createTestClient(app)` wraps any web-standard app (`createWebApp` result)
    for network-free, fully-typed integration tests; `baseUrl` defaults to
    `http://test/api/v1`.

- [#446](https://github.com/forinda/kick-js/pull/446) [`033bae4`](https://github.com/forinda/kick-js/commit/033bae41b2411a20a08363214ff47e0ed3899f57) Thanks [@forinda](https://github.com/forinda)! - feat: `@forinda/kickjs-client` — typed fetch client (R3, closes the response-inference roadmap)

  `kick typegen` now also emits a flat `KickRoutes.Api` map (`'GET /tasks/:id'`
  keys referencing the controller route shapes). The new zero-dependency client
  consumes it:

  ```ts
  import { createClient } from "@forinda/kickjs-client";

  const api = createClient<KickRoutes.Api>({ baseUrl: "https://x/api/v1" });
  const task = await api.get("/tasks/:id", { params: { id: "42" } });
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
