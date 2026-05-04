# @forinda/kickjs

## 5.4.0

### Minor Changes

- [#169](https://github.com/forinda/kick-js/pull/169) [`937f514`](https://github.com/forinda/kick-js/commit/937f514d282111299298acabad931c0e7de5c8c7) Thanks [@forinda](https://github.com/forinda)! - `RequestContext.body`, `params`, `query`, `headers`, `file`, and `files`
  are now typed `DeepReadonly<T>` (or `Readonly<T>` for headers,
  `ReadonlyArray<...>` for files). This is a **type-only** change — no
  runtime difference, no `Object.freeze`, no perf cost — but adopter code
  that mutates these in place will start failing at compile time, **once
  `ctx` is properly typed**:

  ```ts
  // Before — silently accepted, even when bypassing Zod validation
  ctx.body.injectedField = 'computed'
  ctx.headers.authorization = 'fake'
  ctx.files!.push(extra)

  // After — tsc errors
  //   "Cannot assign to 'injectedField' because it is a read-only property."
  //   "Cannot assign to 'authorization' because it is a read-only property."
  //   "Property 'push' does not exist on type 'readonly any[]'."
  ```

  This matches the framework's existing rule — _writes flow through
  `ctx.set(key, value)` or a Context Contributor's return value, not by
  mutating the request bag in place_ — and now the type system enforces
  it.

  ::: tip Protection only kicks in for typed contexts
  The default generic for `RequestContext` is `any`, and `DeepReadonly<any>`
  collapses to `any`. Adopters who write `ctx: RequestContext` get no
  protection (and no breakage). Adopters who write
  `ctx: Ctx<KickRoutes.UserController['create']>` (or pass explicit
  generics like `RequestContext<CreateUserBody>`) get the readonly
  locks the changeset describes. The CLI scaffolders (`kick g scaffold`,
  `kick g controller`) already emit `Ctx<KickRoutes…>` by default, so
  freshly generated controllers see the protection automatically.
  :::

  ### Migration

  Most usages already comply. If you mutate one of these surfaces
  intentionally, two escape hatches:
  1. **Compute and stash** (preferred):
     ```ts
     const enriched = { ...ctx.body, computed: f(ctx.body) }
     ctx.set('enrichedBody', enriched)
     ```
  2. **Drop down to the raw Express handle**:
     ```ts
     ;(ctx.req.body as any).injectedField = 'computed'
     ```

  The escape hatches stay supported. The default just stops surprising
  adopters who validated a payload with Zod, then watched a downstream
  middleware silently mutate it.

  `ctx.session`, `ctx.user`, `ctx.cookies`, and `ctx.requestId` are
  unchanged — those have legitimate write-side flows (auth strategies,
  session stores, etc.) and wrapping them in `Readonly` would create
  real friction.

  A new `DeepReadonly<T>` type alias is exported from
  `@forinda/kickjs` for adopters who want to apply the same lock to
  their own typed payloads.

## 5.3.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.3.0

### Minor Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Add `withBuilder()` factory alongside `@Builder`. Both share the same runtime via the new internal `attachBuilder()` helper.

  ```ts
  // Decorator form — opt into typing with one line
  @Builder
  class UserDto {
    name!: string
    email!: string
    declare static readonly builder: () => BuilderOf<UserDto>
  }

  // Factory form — same runtime, types inferred automatically
  class TaskDtoBase {
    title!: string
    done!: boolean
  }
  export const TaskDto = withBuilder(TaskDtoBase)
  export type TaskDto = InstanceType<typeof TaskDto>
  ```

  `readonly` keeps SonarQube's `typescript:S1444` quiet — the runtime assigns `target.builder` once at decoration time and never reassigns it. Existing `@Builder` adopters keep working without changes; the typing opt-in is additive.
