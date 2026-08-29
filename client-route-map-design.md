# Self-Contained Client Route Map

> Status: **PLANNED** — implements #543.
> Decision owner: @forinda
> Spec: [#543](https://github.com/forinda/kick-js/issues/543) — measurements, the
> failed workarounds, and why this cannot be solved outside typegen.
> Prior art in-repo: `response-inference-design.md` (the inference this reuses),
> `packages/cli/src/typegen/{plugin,runner}.ts` (the vehicle),
> `packages/cli/src/typegen/render/routes.ts` (the emitter this parallels).

---

## 1. Goal

Let a frontend outside the server's TypeScript program consume the route map with
**one import and nothing else** — no `experimentalDecorators`, no `@/*` fallback
into server source, no ambient-augmentation bridge, no `verbatimModuleSyntax`
collision:

```ts
import type { KickApi } from '../../../api/.kickjs/types/kick__client'

export const api = createClient<KickApi>({ baseUrl: '/api/v1' })
```

That is the whole adopter-facing surface. Everything below exists to make that
line work.

## 2. Why today's map can't do it

`kick typegen` emits `KickRoutes.Api` as an **ambient global** whose entries are
**references** into controller classes:

```ts
import type { AcademicCalendarController as _C0 } from '../../src/modules/…'
// … ×1,727

declare global {
  namespace KickRoutes {
    interface Api {
      'GET /academics/terms': AcademicCalendarController['terms']
    }
  }
}
```

`_C0['terms']` is a reference, so resolving it means compiling the controller —
and transitively the service, the repository, the ORM types, the decorators.
Measured on a 1,727-controller app (#543), adding the bridge to one frontend:

| tsconfig                          | errors    | typecheck  | peak RSS    |
| --------------------------------- | --------- | ---------- | ----------- |
| baseline, no bridge               | 0         | **1.69s**  | **819 MB**  |
| bridge + `experimentalDecorators` | **6,457** | —          | —           |
| … + `"@/*": ["../server/src/*"]`  | 313       | —          | —           |
| … + every ambient augmentation    | **1**     | **10.84s** | **4.87 GB** |

**6.4× slower, 6× the memory**, repeated per frontend and per CI run.

The workarounds outside typegen are closed, and #543 records why:

- **`rollup-plugin-dts` / API Extractor** follow _module exports_.
  `KickRoutes.Api` is an ambient global namespace, so they run clean and emit a
  3-line file with zero routes.
- **`tsc --declaration`** preserves the module graph: 1,842 `.d.ts` files, not one.

## 3. Design

### 3.1 The one idea

The server already knows every response type — its own `tsc` resolves
`_C0['terms']` correctly today. So **resolve the types once, on the server side,
and emit the answers** instead of the questions.

```
kick typegen  →  kick__routes.ts    (references, ambient, unchanged)
              →  kick__client.d.ts  (literals, module-scoped, new)
```

The cost moves from _N frontends × every CI run_ to _one server-side pass_, on
the machine that already type-checks the server.

### 3.2 Resolve whole entries, not just responses

The naive read of #543 is "inline the `response` field". Don't do that — the
other fields have the same disease in weaker form. `params`/`body`/`query` are
emitted as `import('zod').infer<typeof _S0>`, which drags the schema modules,
and `renderField`'s fallbacks live in the renderer rather than the type system.

Instead resolve **one type per route**:

```ts
type _K0 = KickRoutes.Api['GET /academics/terms']
```

and expand that. `params`, `body`, `query`, `response`, `contextKeys` all come
out inlined in a single pass, and the client map is _by construction_ the same
type the ambient map has — no second inference path to drift.

This also means `InferHandlerResponse` stays the single source of truth for
response semantics. The client map never re-derives it; it evaluates it.

### 3.3 What "expand" means

`checker.typeToString()` prints named types **by name** (`Term[]`), and those
names don't exist in the client file. The expander walks `ts.Type` and emits
structure instead:

| Input                            | Emitted                           |
| -------------------------------- | --------------------------------- |
| `string`, `42`, `'a' \| 'b'`     | verbatim                          |
| `Term[]`                         | `{ id: string; … }[]`             |
| `Date`, `Promise<T>`, `Map<K,V>` | **by name** — see below           |
| `interface Term { … }` (project) | hoisted to `interface __T0 { … }` |
| recursive / repeated type        | hoisted, referenced by name       |
| depth > 12                       | `unknown` + a named warning       |

**Lib types stay named.** `Date`, `Map`, `RegExp`, `Promise` are declared in
TypeScript's own lib files, which every frontend already has. Expanding them
would be both enormous and wrong. `program.isSourceFileDefaultLibrary(sf)` is
the test — public API, no heuristics on file paths.

**Hoisting is what keeps the file small.** 1,940 routes over ~300 DTOs means
naive inlining multiplies the same shapes hundreds of times. On first encounter
of a named, non-lib object type the expander assigns `__T<n>`, emits the name at
the use site, and expands the body once into a hoisted block. That single
mechanism also terminates cycles (`Student.school.students`) — a type already
being expanded is already named.

### 3.4 Not JSON-shaping (yet)

A response crosses `JSON.stringify` → `JSON.parse`, so a `Date` field is a
`string` on the wire and the emitted `Date` is a lie.

**That lie already exists.** `InferHandlerResponse` does no JSON-shaping, so
today's ambient `KickRoutes.Api` has the same `Date`. Fixing it here would make
the two maps disagree, which breaks the "no second inference
path" property that makes this design safe — and it would silently change types
for every existing adopter of the ambient map.

So: the client map matches the ambient map exactly. JSON-shaping (`Date` → `string`,
`undefined`-drop, `toJSON()` return types, `bigint` → an error) is a real gap and
gets **its own issue**, fixing both maps at once. §7.

### 3.5 Getting a compiler API

The CLI has no compiler-API usage today — the scanner is `oxc-parser`, and
`response-inference-design.md` R2 fixed "the scanner never runs a type checker"
as a constraint. This design does **not** relax it: the scanner stays AST-only,
and the checker lives in a separate plugin that runs after it, on the map it
produced.

TypeScript 7 ships no JS compiler API:

> TypeScript 7 does not ship a compiler API, so please additionally install the
> compatibility package: `@typescript/typescript6`

So the loader tries, in order:

1. `typescript` resolved **from the project**, if it exposes `createProgram`
2. `@typescript/typescript6` resolved from the project
3. a hard error naming the install command

Resolution is from the adopter's `node_modules`, not the CLI's — the program must
be built by the same compiler version that type-checks the server, or the
resolved types can disagree with what the adopter sees. Both go in
`peerDependenciesMeta` as optional, and a project without one gets a warning
and a skipped file rather than a failed pass (§3.6).

### 3.6 Part of the normal typegen pass

There is no `--client` flag and no config switch. `kick typegen` emits
`kick__client.d.ts` the way it emits `kick__routes.ts` — one more generated
file, always current, gated by the same `--check`.

Two consequences follow, and both are requirements rather than options:

**It skips under `--watch`.** The pass builds a full `ts.Program` over the
server: ~11s and `--max-old-space-size=6144` on the reference app, whose own
`typecheck` script already needs that. `kick dev` re-runs typegen on every save,
so emitting there would replace a sub-second loop with an eleven-second one. The
plugin returns `null` (the runner's existing "skip emission" contract) when
`ctx.watch` is set, and the runner prints the reason once per session. The file
is refreshed by the next one-shot `kick typegen`, and `--check` catches it if
that never happens.

**A missing compiler API is a warning, not a failure.** Since this now runs for
every adopter, a project whose compiler API cannot be loaded — most likely TS 7
without `@typescript/typescript6` — must keep `kick typegen` working. The plugin
catches the loader error, warns with the install command, and returns `null`.
Turning an additive feature into a hard break for existing projects is not
acceptable, and a plugin that fails a pass would do exactly that.

## 4. File structure

| File                                                 | Responsibility                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `packages/cli/src/typegen/client/ts-compiler.ts`     | Load a compiler API from the project. Nothing else.             |
| `packages/cli/src/typegen/client/expand-type.ts`     | `ts.Type` → portable source text + hoisted interfaces. Pure.    |
| `packages/cli/src/typegen/client/resolve-entries.ts` | Build the program, resolve one type per route key.              |
| `packages/cli/src/typegen/render/client.ts`          | Assemble the emitted `.d.ts`. Pure, mirrors `render/routes.ts`. |
| `packages/cli/src/typegen/builtin/client.ts`         | The `kick/client` plugin. Wiring, watch skip, missing-API skip. |
| `packages/cli/src/typegen/plugin.ts`                 | `TypegenContext.watch?: boolean` so a plugin can skip in watch. |
| `packages/cli/src/typegen/run-plugins.ts`            | Register `kick/client` after `kick/routes`.                     |

The split is by responsibility, and the boundary that matters is `expand-type.ts`
being pure and independently testable — it is where every hard case lives
(cycles, lib types, depth, optionality) and it must be testable against a
hand-built program with no scanner, no plugin runner, and no fixture app.

## 5. Phases

| Phase  | Content                                                         | Breaking? | Size |
| ------ | --------------------------------------------------------------- | --------- | ---- |
| **C1** | Compiler-API loader + optional peer deps                        | No        | S    |
| **C2** | Type expander (hoisting, cycles, lib types, depth)              | No        | M    |
| **C3** | Program build + per-key entry resolution                        | No        | M    |
| **C4** | Renderer + `kick/client` plugin + watch skip + missing-API skip | No        | M    |
| **C5** | Docs, changeset, `adero-api` reference-app update               | No        | S    |

C2 is the risk. Everything else is wiring.

## 6. Testing

- **C1**: loader picks `typescript` when it has `createProgram`; falls back to
  `@typescript/typescript6` when it doesn't; error text names the install command.
- **C2**: a hand-built in-memory `ts.Program` per case — primitives, unions,
  literals, arrays, tuples, optional properties, index signatures, `Date`
  staying named, a project interface hoisting, a self-referencing type
  terminating, the same type used twice hoisting once, depth cutoff.
- **C3**: a fixture server (`examples/typegen-test`) — every key in the ambient
  map appears in the resolved output, and a route whose response is a project
  interface resolves to its structure.
- **C4**: golden-file test of the emitted `.d.ts`; `--check` drift; the plugin
  returns `null` under watch; the plugin returns `null` and warns (rather than
  throwing) when no compiler API loads.
- **End-to-end (the one that matters)**: a frontend tsconfig with **no**
  `experimentalDecorators`, **no** `paths`, and `verbatimModuleSyntax: true`
  type-checks `createClient<KickApi>` against the emitted file, and a wrong
  path (`api.get('/nope')`) still fails to compile.

## 7. Non-goals

- **JSON-shaping** (`Date` → `string`, `undefined`-drop, `toJSON()`, `bigint`).
  Real gap, affects the ambient map equally, separate issue — §3.4.
- **A runtime RPC manifest.** `kickRpc` is a value; a `.d.ts` cannot carry one.
  A sibling `kick__client.rpc.ts` is possible later and needs no new inference.
- **Incremental / watch-mode resolution.** Needs a persisted program; the pass
  is a build step.
- **Emitting per-frontend subsets.** Route-level tree-shaking is a size
  optimization for a file nobody reads.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kick typegen` emits one self-contained `.d.ts` a frontend can consume
with a single type-only import.

**Architecture:** Resolve `KickRoutes.Api['<key>']` for every route through a
`ts.Program` built over the server, expand each resolved type structurally with
shared shapes hoisted to local interfaces, and emit a module-scoped
`export interface KickApi`.

**Tech Stack:** TypeScript compiler API (`typescript`, or `@typescript/typescript6`
on TS 7) — both optional peer deps loaded from the _project_; existing
`kick typegen` plugin runner; vitest.

**Spec:** [#543](https://github.com/forinda/kick-js/issues/543), and §1–§7 above.

## Global Constraints

- The scanner stays **AST-only** (`oxc-parser`). The checker lives in
  `typegen/client/**`, downstream of it.
- `typescript` and `@typescript/typescript6` are **optional peer deps**, resolved
  from the adopter's `node_modules`, never bundled, never required by any other
  command.
- The map is part of **every one-shot `kick typegen`** — no flag, no config
  switch. It is **skipped under `--watch`**, and a missing compiler API
  **warns and skips** rather than failing the pass.
- The emitted file has **zero imports**. Any import in the output is a bug.
- Emitted types must equal `KickRoutes.Api[key]` — no second inference path.
- Prettier: no semicolons, single quotes, trailing commas, 100 cols. Run
  `pnpm format` before every commit.
- Every new file carries a module-level doc comment; the repo's existing typegen
  files are the tone reference.

---

### Task 1: Compiler-API loader

**Files:**

- Create: `packages/cli/src/typegen/client/ts-compiler.ts`
- Modify: `packages/cli/package.json` (add `peerDependencies` +
  `peerDependenciesMeta` entries)
- Test: `packages/cli/__tests__/client-ts-compiler.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export type TsApi = typeof import('typescript')
  export function loadCompilerApi(projectDir: string): Promise<TsApi>
  ```

  Task 3 calls `loadCompilerApi(ctx.cwd)` and treats the result as the `ts`
  namespace.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The compiler API is optional and version-sensitive: it must come from the
 * ADOPTER's node_modules, because a program built by a different TypeScript
 * than the one checking the server can resolve types differently — and a
 * client map that disagrees with the server is worse than no client map.
 *
 * TypeScript 7 ships no JS compiler API, so `typescript` may resolve to a
 * package with no `createProgram`. That is the fallback trigger, not an error.
 */
import { describe, expect, it, vi } from 'vitest'
import { pickCompilerModule } from '../src/typegen/client/ts-compiler'

describe('pickCompilerModule', () => {
  it('takes typescript when it exposes createProgram', () => {
    const ts6 = { createProgram: vi.fn() }
    const pick = pickCompilerModule({ typescript: { createProgram: vi.fn() }, ts6 })
    expect(pick.source).toBe('typescript')
  })

  it('falls back when typescript has no compiler API (TS 7)', () => {
    // TS 7's `typescript` package: a CLI, not an API.
    const pick = pickCompilerModule({
      typescript: { version: '7.0.2' },
      ts6: { createProgram: vi.fn() },
    })
    expect(pick.source).toBe('@typescript/typescript6')
  })

  it('reports both candidates as missing rather than guessing', () => {
    expect(() => pickCompilerModule({ typescript: null, ts6: null })).toThrow(
      /pnpm add -D @typescript\/typescript6/,
    )
  })

  it('names the TS 7 case specifically when only typescript is present', () => {
    expect(() => pickCompilerModule({ typescript: { version: '7.0.2' }, ts6: null })).toThrow(
      /TypeScript 7 does not ship a compiler API/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-ts-compiler.test.ts`
Expected: FAIL — `Failed to resolve import "../src/typegen/client/ts-compiler"`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Loads a TypeScript compiler API for the client route map.
 *
 * Two things make this more than a dynamic import:
 *
 * 1. **It must come from the project.** A program built by a different
 *    TypeScript than the one checking the server can resolve types
 *    differently, and a client map that disagrees with the server is worse
 *    than no client map at all. So resolution goes through the adopter's
 *    `node_modules`, not the CLI's.
 * 2. **TypeScript 7 ships no JS compiler API.** `typescript` may resolve to a
 *    package that has a version and a binary and no `createProgram`. That is
 *    the documented state of TS 7, not a broken install, and the fix is the
 *    compatibility package — so say so by name.
 *
 * @module @forinda/kickjs-cli/typegen/client/ts-compiler
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

export type TsApi = typeof import('typescript')

const TS6 = '@typescript/typescript6'

export interface CompilerCandidates {
  typescript: unknown
  ts6: unknown
}

export interface CompilerPick {
  api: TsApi
  source: 'typescript' | typeof TS6
}

/** Whether a resolved module actually carries the compiler API we need. */
function hasCompilerApi(mod: unknown): mod is TsApi {
  return typeof (mod as { createProgram?: unknown } | null)?.createProgram === 'function'
}

/**
 * Choose between the two candidates. Split from the I/O so the decision —
 * which is the part with the interesting cases — is testable without a
 * node_modules tree.
 */
export function pickCompilerModule(candidates: CompilerCandidates): CompilerPick {
  if (hasCompilerApi(candidates.typescript)) {
    return { api: candidates.typescript, source: 'typescript' }
  }
  if (hasCompilerApi(candidates.ts6)) {
    return { api: candidates.ts6, source: TS6 }
  }
  const install = `Install it in the project:\n    pnpm add -D ${TS6}`
  if (candidates.typescript) {
    throw new Error(
      `kick typegen: the client route map needs a TypeScript compiler API.\n` +
        `  TypeScript 7 does not ship a compiler API, so the compatibility ` +
        `package is required.\n  ${install}`,
    )
  }
  throw new Error(
    `kick typegen: the client route map needs a TypeScript compiler API, and neither ` +
      `'typescript' nor '${TS6}' resolved from this project.\n  ${install}`,
  )
}

/**
 * Resolve and import a compiler API from `projectDir`. Returns the `ts`
 * namespace.
 */
export async function loadCompilerApi(projectDir: string): Promise<TsApi> {
  const require = createRequire(join(projectDir, 'package.json'))
  const load = async (name: string): Promise<unknown> => {
    try {
      return await import(pathToFileHref(require.resolve(name)))
    } catch {
      // Unresolvable / unloadable both mean "not a candidate" — pickCompilerModule
      // turns the absence into the actionable message.
      return null
    }
  }
  const [typescript, ts6] = await Promise.all([load('typescript'), load(TS6)])
  return pickCompilerModule({
    typescript: unwrapDefault(typescript),
    ts6: unwrapDefault(ts6),
  }).api
}

/** `typescript` is CJS — the namespace lands on `.default` under ESM import. */
function unwrapDefault(mod: unknown): unknown {
  const withDefault = mod as { default?: unknown } | null
  if (withDefault?.default && typeof withDefault.default === 'object') return withDefault.default
  return mod
}

function pathToFileHref(absPath: string): string {
  return new URL(`file://${absPath}`).href
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-ts-compiler.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Declare the optional peer deps**

In `packages/cli/package.json`, add alongside the existing fields:

```json
"peerDependencies": {
  "typescript": ">=5.0.0",
  "@typescript/typescript6": "*"
},
"peerDependenciesMeta": {
  "typescript": { "optional": true },
  "@typescript/typescript6": { "optional": true }
}
```

If a `peerDependencies` block already exists, merge into it rather than
replacing it.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/cli/src/typegen/client/ts-compiler.ts \
        packages/cli/__tests__/client-ts-compiler.test.ts \
        packages/cli/package.json
git commit -m "feat(cli): load an optional TypeScript compiler API from the project"
```

---

### Task 2: Structural type expander

**Files:**

- Create: `packages/cli/src/typegen/client/expand-type.ts`
- Test: `packages/cli/__tests__/client-expand-type.test.ts`

**Interfaces:**

- Consumes: `TsApi` from Task 1.
- Produces:

  ```ts
  export interface ExpandResult {
    /** Source text for the type at the use site, e.g. `__T0[]`. */
    text: string
  }
  export class TypeExpander {
    constructor(
      ts: TsApi,
      checker: ts.TypeChecker,
      program: ts.Program,
      opts?: { maxDepth?: number; onWarn?: (msg: string) => void },
    )
    expand(type: ts.Type): string
    /** `interface __T0 { … }` blocks for every hoisted shape, in creation order. */
    hoisted(): string[]
  }
  ```

  Task 4 calls `expand()` once per route and emits `hoisted()` above the
  `KickApi` interface.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The expander turns a resolved `ts.Type` into text that compiles in a file
 * with NO imports. That is the whole point of the client map, so every case
 * here is about a way a type can secretly depend on the server's program.
 *
 * The in-memory program keeps these tests honest: no fixture app, no scanner,
 * no plugin runner — just a source string and the type it produces.
 */
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { TypeExpander } from '../src/typegen/client/expand-type'

/** Build a one-file program and hand back the type of `type Target = …`. */
function typeOf(source: string): {
  expander: TypeExpander
  target: ts.Type
} {
  const fileName = '/virtual/input.ts'
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true)
  const host: ts.CompilerHost = {
    getSourceFile: (name) =>
      name === fileName
        ? sourceFile
        : ts.createSourceFile(name, defaultLib(name), ts.ScriptTarget.ES2022, true),
    writeFile: () => {},
    getDefaultLibFileName: () => ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }),
    getCurrentDirectory: () => '/virtual',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: () => true,
    readFile: (name) => (name === fileName ? source : defaultLib(name)),
  }
  const program = ts.createProgram({
    rootNames: [fileName],
    options: { target: ts.ScriptTarget.ES2022, strict: true, lib: ['lib.es2022.d.ts'] },
    host,
  })
  const checker = program.getTypeChecker()
  const alias = sourceFile.statements.find(
    (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'Target',
  )!
  return {
    expander: new TypeExpander(ts, checker, program),
    target: checker.getTypeAtLocation(alias.type),
  }
}

function defaultLib(name: string): string {
  return ts.sys.readFile(name) ?? ''
}

const expand = (source: string) => {
  const { expander, target } = typeOf(source)
  return { text: expander.expand(target), hoisted: expander.hoisted() }
}

describe('TypeExpander', () => {
  it('passes primitives through', () => {
    expect(expand('type Target = string').text).toBe('string')
    expect(expand('type Target = number').text).toBe('number')
    expect(expand('type Target = boolean').text).toBe('boolean')
  })

  it('keeps literal and union types exact', () => {
    expect(expand("type Target = 'a' | 'b'").text).toBe("'a' | 'b'")
  })

  it('expands an anonymous object structurally', () => {
    expect(expand('type Target = { id: string; n: number }').text).toBe('{ id: string; n: number }')
  })

  it('marks optional properties optional', () => {
    expect(expand('type Target = { id?: string }').text).toBe('{ id?: string }')
  })

  it('expands arrays through their element type', () => {
    expect(expand('type Target = { id: string }[]').text).toBe('{ id: string }[]')
  })

  it('keeps lib types by name — every frontend already has them', () => {
    // Expanding Date would emit hundreds of methods AND be wrong.
    expect(expand('type Target = { at: Date }').text).toBe('{ at: Date }')
  })

  it('hoists a named project interface instead of inlining it everywhere', () => {
    const out = expand(`
      interface Term { id: string; name: string }
      type Target = { a: Term; b: Term }
    `)
    expect(out.text).toBe('{ a: __T0; b: __T0 }')
    expect(out.hoisted()).toEqual(['interface __T0 {\n  id: string\n  name: string\n}'])
  })

  it('terminates on a self-referencing type', () => {
    const out = expand(`
      interface Node { id: string; parent: Node | null }
      type Target = Node
    `)
    expect(out.text).toBe('__T0')
    expect(out.hoisted()[0]).toContain('parent: __T0 | null')
  })

  it('emits an index signature', () => {
    expect(expand('type Target = { [k: string]: number }').text).toBe('{ [key: string]: number }')
  })

  it('cuts off runaway depth rather than hanging', () => {
    const { expander, target } = typeOf('type Target = { a: { b: { c: string } } }')
    const shallow = new TypeExpander(
      ts,
      (expander as never as { checker: ts.TypeChecker }).checker,
      undefined as never,
      {
        maxDepth: 1,
      },
    )
    expect(shallow.expand(target)).toContain('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-expand-type.test.ts`
Expected: FAIL — `Failed to resolve import "../src/typegen/client/expand-type"`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * `ts.Type` → source text that compiles in a file with **no imports**.
 *
 * `checker.typeToString()` cannot do this: it prints named types by name, and
 * those names live in the server's program. The client map exists precisely so
 * the frontend does not compile the server, so every name has to be either
 * expanded into structure or proven to exist in the frontend already.
 *
 * Three rules carry the whole design:
 *
 * 1. **Lib types stay named.** `Date`, `Map`, `Promise`, `RegExp` are declared
 *    in TypeScript's own lib files, which every frontend has. Expanding them
 *    would be enormous and wrong.
 * 2. **Named project types hoist.** 1,940 routes over ~300 DTOs means naive
 *    inlining multiplies the same shapes hundreds of times. Each named shape
 *    becomes one `interface __T<n>` and is referenced by name.
 * 3. **Hoisting is also cycle termination.** `Student.school.students` is
 *    infinite to inline; a type already being expanded already has a name.
 *
 * @module @forinda/kickjs-cli/typegen/client/expand-type
 */
import type ts from 'typescript'
import type { TsApi } from './ts-compiler'

export interface TypeExpanderOptions {
  /** Depth beyond which a type degrades to `unknown`. Default 12. */
  maxDepth?: number
  onWarn?: (msg: string) => void
}

export class TypeExpander {
  private readonly hoistedByType = new Map<ts.Type, string>()
  private readonly blocks: string[] = []
  private readonly maxDepth: number

  constructor(
    private readonly ts: TsApi,
    private readonly checker: ts.TypeChecker,
    private readonly program: ts.Program,
    private readonly opts: TypeExpanderOptions = {},
  ) {
    this.maxDepth = opts.maxDepth ?? 12
  }

  /** Hoisted `interface __T<n> { … }` blocks, in creation order. */
  hoisted(): string[] {
    return this.blocks
  }

  expand(type: ts.Type): string {
    return this.render(type, 0)
  }

  private render(type: ts.Type, depth: number): string {
    const { ts: t } = this
    const F = t.TypeFlags

    if (depth > this.maxDepth) {
      this.opts.onWarn?.(
        `type nesting exceeded ${this.maxDepth} levels — emitting 'unknown'. ` +
          `Declare a response schema on the route for an exact type.`,
      )
      return 'unknown'
    }

    // Primitives and keywords — typeToString is exactly right for these and
    // carries no names from the program.
    if (type.flags & (F.String | F.Number | F.Boolean | F.BigInt | F.ESSymbol)) {
      return this.checker.typeToString(type)
    }
    if (type.flags & (F.Any | F.Unknown | F.Never | F.Void | F.Undefined | F.Null)) {
      return this.checker.typeToString(type)
    }
    if (type.isLiteral() || type.flags & F.BooleanLiteral) {
      return this.checker.typeToString(type)
    }

    if (type.isUnion()) {
      return type.types.map((m) => this.render(m, depth + 1)).join(' | ')
    }
    if (type.isIntersection()) {
      return type.types.map((m) => this.render(m, depth + 1)).join(' & ')
    }

    // Tuples before arrays — a tuple is also a type reference to Array.
    if (this.isTuple(type)) {
      const args = this.checker.getTypeArguments(type as ts.TypeReference)
      return `[${args.map((a) => this.render(a, depth + 1)).join(', ')}]`
    }
    const element = this.arrayElement(type)
    if (element) {
      const inner = this.render(element, depth + 1)
      // Parenthesise unions so `A | B[]` doesn't mean the wrong thing.
      return /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`
    }

    // A type the frontend already has — emit the name, expand nothing.
    if (this.isLibType(type)) return this.checker.typeToString(type)

    if (type.flags & F.Object) return this.renderObject(type, depth)

    // Type parameters, conditionals that didn't resolve, anything unmodelled.
    this.opts.onWarn?.(
      `could not expand type '${this.checker.typeToString(type)}' — emitting 'unknown'`,
    )
    return 'unknown'
  }

  private renderObject(type: ts.Type, depth: number): string {
    const existing = this.hoistedByType.get(type)
    if (existing) return existing

    const named = this.isNamed(type)
    if (named) {
      // Reserve the name BEFORE expanding the body: a self-referencing type
      // must find its own name already in the map.
      const name = `__T${this.hoistedByType.size}`
      this.hoistedByType.set(type, name)
      const index = this.blocks.length
      this.blocks.push('') // hold the slot so ordering matches creation order
      this.blocks[index] = `interface ${name} {\n${this.members(type, depth, '  ')}\n}`
      return name
    }

    const inline = this.members(type, depth, '', '; ')
    return inline.length > 0 ? `{ ${inline} }` : '{}'
  }

  private members(type: ts.Type, depth: number, indent: string, join = '\n'): string {
    const { ts: t } = this
    const lines: string[] = []

    for (const info of this.checker.getIndexInfosOfType(type)) {
      const key = this.checker.typeToString(info.keyType)
      lines.push(`${indent}[key: ${key}]: ${this.render(info.type, depth + 1)}`)
    }

    for (const prop of this.checker.getPropertiesOfType(type)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0]
      const propType = decl
        ? this.checker.getTypeOfSymbolAtLocation(prop, decl)
        : this.checker.getDeclaredTypeOfSymbol(prop)
      const optional = (prop.flags & t.SymbolFlags.Optional) !== 0
      // An optional property's type already includes `undefined`; emitting both
      // is noise, and `exactOptionalPropertyTypes` makes it a difference.
      const rendered = this.render(
        optional ? this.checker.getNonNullableType(propType) : propType,
        depth + 1,
      )
      lines.push(`${indent}${this.propName(prop.name)}${optional ? '?' : ''}: ${rendered}`)
    }
    return lines.join(join === '\n' ? '\n' : join)
  }

  /** Quote a property name that isn't a plain identifier. */
  private propName(name: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
  }

  /** Declared in TypeScript's own lib files → the frontend already has it. */
  private isLibType(type: ts.Type): boolean {
    const decls = type.getSymbol()?.declarations
    if (!decls || decls.length === 0) return false
    return decls.every((d) => this.program.isSourceFileDefaultLibrary(d.getSourceFile()))
  }

  /** Has a declared name worth hoisting (interface / class / named alias). */
  private isNamed(type: ts.Type): boolean {
    const symbol = type.getSymbol()
    if (!symbol) return false
    const name = symbol.getName()
    return name !== '__type' && name !== '__object' && name.length > 0
  }

  private isTuple(type: ts.Type): boolean {
    const { ts: t } = this
    const target = (type as ts.TypeReference).target as ts.TypeReference | undefined
    return Boolean(
      type.flags & t.TypeFlags.Object &&
      (type as ts.ObjectType).objectFlags & t.ObjectFlags.Reference &&
      target &&
      (target as unknown as ts.TupleType).objectFlags & t.ObjectFlags.Tuple,
    )
  }

  /** Element type if `type` is `T[]` / `ReadonlyArray<T>`, else null. */
  private arrayElement(type: ts.Type): ts.Type | null {
    const symbolName = type.getSymbol()?.getName()
    if (symbolName !== 'Array' && symbolName !== 'ReadonlyArray') return null
    const args = this.checker.getTypeArguments(type as ts.TypeReference)
    return args.length === 1 ? args[0] : null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-expand-type.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/cli/src/typegen/client/expand-type.ts \
        packages/cli/__tests__/client-expand-type.test.ts
git commit -m "feat(cli): expand resolved types into import-free source text"
```

---

### Task 3: Program build and per-route entry resolution

**Files:**

- Create: `packages/cli/src/typegen/client/resolve-entries.ts`
- Test: `packages/cli/__tests__/client-resolve-entries.test.ts`

**Interfaces:**

- Consumes: `loadCompilerApi` (Task 1), `TypeExpander` (Task 2).
- Produces:

  ```ts
  export interface ResolvedClientMap {
    /** Route key (`'GET /users/:id'`) → expanded entry source text. */
    entries: Map<string, string>
    /** `interface __T0 { … }` blocks to emit above the map. */
    hoisted: string[]
  }
  export function resolveClientMap(opts: {
    projectDir: string
    routesFile: string
    keys: string[]
    onWarn?: (msg: string) => void
  }): Promise<ResolvedClientMap>
  ```

  Task 4 passes the keys from the scan result and renders `entries` directly.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The resolution step is where "the server already knows this" becomes a
 * literal type. It leans on a property worth stating: the emitted entry MUST
 * equal `KickRoutes.Api[key]`, because that is what makes the client map
 * incapable of drifting from the ambient one.
 *
 * The test builds a miniature routes file with the same shape typegen emits
 * (module + `declare global` + namespace) rather than a fixture app, so a
 * failure points at resolution rather than at the scanner.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveClientMap } from '../src/typegen/client/resolve-entries'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kick-client-'))
  mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, type: 'module' }),
  )
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
      },
      include: ['.kickjs', 'src'],
    }),
  )
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'src/term.ts'),
    `export interface Term { id: string; name: string; startsAt: Date }\n`,
  )
  writeFileSync(
    join(dir, '.kickjs/types/kick__routes.ts'),
    `import type { Term } from '../../src/term'
declare global {
  namespace KickRoutes {
    interface Api {
      'GET /terms': { params: {}; body: unknown; query: unknown; response: Term[]; contextKeys: never }
    }
  }
}
export const kickRpc = {} as const
`,
  )
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveClientMap', () => {
  it('resolves an entry to structure, with named shapes hoisted', async () => {
    const out = await resolveClientMap({
      projectDir: dir,
      routesFile: join(dir, '.kickjs/types/kick__routes.ts'),
      keys: ['GET /terms'],
    })

    const entry = out.entries.get('GET /terms')!
    expect(entry).toContain('response: __T0[]')
    expect(out.hoisted.join('\n')).toContain('startsAt: Date')
    // The point of the whole feature: nothing reaches back into src/.
    expect(entry).not.toContain('import')
    expect(out.hoisted.join('\n')).not.toContain('src/term')
  })

  it('warns and skips a key the program does not have', async () => {
    const warnings: string[] = []
    const out = await resolveClientMap({
      projectDir: dir,
      routesFile: join(dir, '.kickjs/types/kick__routes.ts'),
      keys: ['GET /terms', 'GET /ghost'],
      onWarn: (m) => warnings.push(m),
    })
    expect(out.entries.has('GET /ghost')).toBe(false)
    expect(warnings.join('\n')).toContain('GET /ghost')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-resolve-entries.test.ts`
Expected: FAIL — `Failed to resolve import "../src/typegen/client/resolve-entries"`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Resolve every route entry to a concrete type, using the server's own
 * program.
 *
 * The mechanism is deliberately small: synthesise one source file of type
 * aliases over the map typegen already emits —
 *
 *     type _K0 = KickRoutes.Api['GET /terms']
 *
 * — and ask the checker what each one is. That reuses `InferHandlerResponse`
 * and the schema wiring verbatim instead of reimplementing them, which is what
 * guarantees the client map cannot drift from the ambient map: there is only
 * one inference path, and this evaluates it.
 *
 * Resolving the WHOLE entry rather than just `response` is the same argument
 * applied to `params` / `body` / `query`, which are emitted as
 * `import('zod').infer<typeof _S0>` and drag the schema modules for the same
 * reason the response drags the controllers.
 *
 * @module @forinda/kickjs-cli/typegen/client/resolve-entries
 */
import { dirname, join } from 'node:path'

import type ts from 'typescript'
import { loadCompilerApi } from './ts-compiler'
import { TypeExpander } from './expand-type'

export interface ResolvedClientMap {
  entries: Map<string, string>
  hoisted: string[]
}

export interface ResolveClientMapOptions {
  projectDir: string
  /** Absolute path to the generated `kick__routes.ts`. */
  routesFile: string
  /** Route keys, e.g. `'GET /users/:id'`. */
  keys: string[]
  onWarn?: (msg: string) => void
}

const PROBE = '__kick_client_probe__.ts'

export async function resolveClientMap(opts: ResolveClientMapOptions): Promise<ResolvedClientMap> {
  const t = await loadCompilerApi(opts.projectDir)
  const probePath = join(dirname(opts.routesFile), PROBE)
  const probeSource = renderProbe(opts.routesFile, probePath, opts.keys)

  const program = createProbeProgram(t, opts.projectDir, probePath, probeSource)
  const checker = program.getTypeChecker()
  const probe = program.getSourceFile(probePath)
  if (!probe) {
    throw new Error(
      `kick/client: could not add the resolution probe to the program. ` +
        `Check that ${opts.routesFile} exists — run \`kick typegen\` first.`,
    )
  }

  const expander = new TypeExpander(t, checker, program, { onWarn: opts.onWarn })
  const entries = new Map<string, string>()

  probe.statements.forEach((stmt, index) => {
    if (!t.isTypeAliasDeclaration(stmt)) return
    const key = opts.keys[index - 1] // statement 0 is the import
    const type = checker.getTypeAtLocation(stmt.type)
    if (type.flags & t.TypeFlags.Any || checker.typeToString(type) === 'error') {
      opts.onWarn?.(
        `route '${key}' is not present in KickRoutes.Api — skipped. ` +
          `Re-run \`kick typegen\` so the two maps agree.`,
      )
      return
    }
    entries.set(key, expander.expand(type))
  })

  for (const key of opts.keys) {
    if (!entries.has(key)) {
      opts.onWarn?.(`route '${key}' could not be resolved — skipped.`)
    }
  }

  return { entries, hoisted: expander.hoisted() }
}

/** One import (to activate the global augmentation) + one alias per key. */
function renderProbe(routesFile: string, probePath: string, keys: string[]): string {
  const specifier = './' + routesFile.split('/').pop()!.replace(/\.ts$/, '')
  const aliases = keys.map((key, i) => `type _K${i} = KickRoutes.Api[${JSON.stringify(key)}]`)
  return [`import ${JSON.stringify(specifier)}`, ...aliases].join('\n') + '\n'
}

/**
 * Build a program over the project's tsconfig with the probe added as a root.
 * The probe lives only in memory — writing it would leave a stray file in
 * `.kickjs/types/` whenever the pass is interrupted.
 */
function createProbeProgram(
  t: typeof ts,
  projectDir: string,
  probePath: string,
  probeSource: string,
): ts.Program {
  const configPath = join(projectDir, 'tsconfig.json')
  const host: ts.ParseConfigFileHost = {
    ...t.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(t.flattenDiagnosticMessageText(d.messageText, '\n'))
    },
  }
  const parsed = t.getParsedCommandLineOfConfigFile(configPath, {}, host)
  if (!parsed) {
    throw new Error(`kick/client: could not read ${configPath}`)
  }

  const compilerHost = t.createCompilerHost(parsed.options, true)
  const readFile = compilerHost.readFile.bind(compilerHost)
  const getSourceFile = compilerHost.getSourceFile.bind(compilerHost)
  compilerHost.readFile = (name) => (name === probePath ? probeSource : readFile(name))
  compilerHost.fileExists = (name) => name === probePath || t.sys.fileExists(name)
  compilerHost.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === probePath
      ? t.createSourceFile(name, probeSource, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreate)

  return t.createProgram({
    rootNames: [...parsed.fileNames, probePath],
    options: parsed.options,
    host: compilerHost,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-resolve-entries.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/cli/src/typegen/client/resolve-entries.ts \
        packages/cli/__tests__/client-resolve-entries.test.ts
git commit -m "feat(cli): resolve KickRoutes.Api entries through the server's program"
```

---

### Task 4: Renderer and plugin

**Files:**

- Create: `packages/cli/src/typegen/render/client.ts`
- Create: `packages/cli/src/typegen/builtin/client.ts`
- Modify: `packages/cli/src/typegen/plugin.ts` (add `TypegenContext.watch`)
- Modify: `packages/cli/src/typegen/runner.ts` (populate `ctx.watch`)
- Modify: `packages/cli/src/typegen/run-plugins.ts` (register the plugin)
- Test: `packages/cli/__tests__/client-render.test.ts`
- Test: `packages/cli/__tests__/client-plugin-skips.test.ts`

**Interfaces:**

- Consumes: `resolveClientMap` (Task 3).
- Produces:

  ```ts
  export function renderClient(map: ResolvedClientMap, keys: string[]): string
  export const kickClientTypegen: () => TypegenPlugin // id: 'kick/client'
  ```

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The emitted file has exactly one job: compile in a frontend that knows
 * nothing about the server. So the assertions are mostly about what is ABSENT
 * — no imports, no ambient `declare global`, no reference to server paths.
 */
import { describe, expect, it } from 'vitest'
import { renderClient } from '../src/typegen/render/client'

describe('renderClient', () => {
  it('emits a module-scoped interface with no imports', () => {
    const out = renderClient(
      {
        entries: new Map([['GET /terms', '{ params: {}; response: __T0[] }']]),
        hoisted: ['interface __T0 {\n  id: string\n}'],
      },
      ['GET /terms'],
    )

    expect(out).toContain('export interface KickApi {')
    expect(out).toContain("'GET /terms': { params: {}; response: __T0[] }")
    expect(out).toContain('interface __T0 {')
    expect(out).not.toContain('import ')
    expect(out).not.toContain('declare global')
  })

  it('still emits a usable empty map before the first route exists', () => {
    const out = renderClient({ entries: new Map(), hoisted: [] }, [])
    expect(out).toContain('export interface KickApi {}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-render.test.ts`
Expected: FAIL — `Failed to resolve import "../src/typegen/render/client"`

- [ ] **Step 3: Write the renderer**

```ts
/**
 * Emit the self-contained client route map.
 *
 * Everything about this file's shape is in service of one line in an adopter's
 * frontend:
 *
 *     import type { KickApi } from '../../../api/.kickjs/types/kick__client'
 *
 * So: module-scoped (a dts bundler can follow module exports; it cannot follow
 * an ambient global — that is why #543's `rollup-plugin-dts` attempt emitted
 * zero routes), no imports at all (an import is a dependency on the server's
 * program, which is the thing being removed), and hoisted interfaces above the
 * map so 1,940 routes over ~300 shapes stay proportional to the shapes.
 *
 * @module @forinda/kickjs-cli/typegen/render/client
 */
import type { ResolvedClientMap } from '../client/resolve-entries'

const HEADER = `/* eslint-disable */
// AUTO-GENERATED by \`kick typegen\`. DO NOT EDIT.
//
// Self-contained: this file has no imports, so a frontend consumes it without
// compiling the server, its decorators, or its path aliases.
//
//   import type { KickApi } from './path/to/kick__client'
//   export const api = createClient<KickApi>({ baseUrl: '/api/v1' })
`

export function renderClient(map: ResolvedClientMap, keys: string[]): string {
  if (keys.length === 0 || map.entries.size === 0) {
    return `${HEADER}
// (no routes discovered yet — annotate a controller method with
//  @Get/@Post/@Put/@Delete/@Patch and re-run \`kick typegen\`)
export interface KickApi {}
`
  }

  const hoisted = map.hoisted.length > 0 ? map.hoisted.join('\n\n') + '\n\n' : ''
  const lines = keys
    .filter((key) => map.entries.has(key))
    .map((key) => `  ${JSON.stringify(key)}: ${map.entries.get(key)!}`)

  return `${HEADER}
${hoisted}export interface KickApi {
${lines.join('\n')}
}
`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-render.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the plugin**

```ts
/**
 * `kick/client` typegen plugin — the self-contained client route map (#543).
 *
 * Part of every one-shot `kick typegen`, with two skips that are requirements
 * rather than options:
 *
 * 1. **Watch.** The pass builds a full `ts.Program` over the server (~11s and
 *    >4 GB on a 1,727-controller app). `kick dev` re-runs typegen on every
 *    save, so emitting there would trade a sub-second loop for an
 *    eleven-second one. The next one-shot run refreshes the file, and
 *    `--check` catches it if that never happens.
 * 2. **No compiler API.** Since this runs for everyone, a project that cannot
 *    load one — most likely TS 7 without `@typescript/typescript6` — must
 *    still get a working `kick typegen`. Warn, skip, carry on. Turning an
 *    additive feature into a hard break for existing projects is not a
 *    tradeoff worth making.
 *
 * Ordering matters — it reads the map `kick/routes` emits, so it must run
 * after it. The runner preserves registration order.
 *
 * @module @forinda/kickjs-cli/typegen/builtin/client
 */
import path from 'node:path'

import { resolveClientMap } from '../client/resolve-entries'
import { renderClient } from '../render/client'
import type { TypegenPlugin } from '../plugin'

export const kickClientTypegen = (): TypegenPlugin => ({
  id: 'kick/client',
  outExtension: '.d.ts',
  inputs: ['src/**/*.controller.ts', 'src/**/*.module.ts'],
  async generate(ctx) {
    if (ctx.watch) {
      ctx.log.info(
        `kick/client: skipped under --watch (builds a full TypeScript program). ` +
          `Run \`kick typegen\` to refresh the client map.`,
      )
      return null
    }

    const scan = await ctx.getScanResult({
      root: path.resolve(ctx.cwd, ctx.config?.typegen?.srcDir ?? 'src'),
      cwd: ctx.cwd,
    })

    // Same key derivation as render/routes.ts, including the mounted-path
    // preference — a bare decorator path collides across controllers.
    const keys: string[] = []
    const seen = new Set<string>()
    for (const route of scan.routes) {
      const key = `${route.httpMethod} ${route.mountedPath ?? route.path}`
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }

    const routesFile = path.resolve(ctx.cwd, '.kickjs/types/kick__routes.ts')
    try {
      const map = await resolveClientMap({
        projectDir: ctx.cwd,
        routesFile,
        keys,
        onWarn: (msg) => ctx.log.warn(msg),
      })
      return renderClient(map, keys)
    } catch (err) {
      // Every adopter runs this plugin, so a compiler API that will not load
      // must not take `kick typegen` down with it. loadCompilerApi's message
      // already names the install command.
      ctx.log.warn(`kick/client: skipped — ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  },
})
```

- [ ] **Step 6: Write the skip test**

```ts
/**
 * Both skips exist to protect something that already works: the sub-second
 * `kick dev` loop, and `kick typegen` on a project with no compiler API. A
 * regression in either is silent — the file just stops being emitted, or the
 * whole pass starts failing — so they get an explicit test.
 */
import { describe, expect, it, vi } from 'vitest'
import { kickClientTypegen } from '../src/typegen/builtin/client'

const baseCtx = (over: Record<string, unknown> = {}) => ({
  cwd: '/nonexistent-project',
  config: {},
  importTs: vi.fn(),
  writeFile: vi.fn(),
  getScanResult: vi.fn().mockResolvedValue({ routes: [] }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  ...over,
})

describe('kick/client plugin', () => {
  it('emits nothing under watch, and says why', async () => {
    const ctx = baseCtx({ watch: true })
    expect(await kickClientTypegen().generate(ctx as never)).toBeNull()
    expect(ctx.log.info.mock.calls.join(' ')).toContain('--watch')
    // The expensive part must not even be reached.
    expect(ctx.getScanResult).not.toHaveBeenCalled()
  })

  it('warns and skips when no compiler API loads, instead of failing typegen', async () => {
    const ctx = baseCtx()
    expect(await kickClientTypegen().generate(ctx as never)).toBeNull()
    expect(ctx.log.warn.mock.calls.join(' ')).toContain('@typescript/typescript6')
  })
})
```

- [ ] **Step 7: Add `watch` to the plugin context**

In `packages/cli/src/typegen/plugin.ts`, add to `TypegenContext`:

```ts
  /**
   * True when this pass is part of a watch loop (`kick typegen --watch`,
   * `kick dev`). Plugins whose work is a build-step cost rather than a
   * keystroke cost return `null` when it is set — see `kick/client`.
   */
  watch?: boolean
```

In `packages/cli/src/typegen/runner.ts`, thread the existing watch flag into
the context object the runner builds for each plugin. `watchTypegen` is the
caller that sets it; the one-shot path leaves it undefined.

- [ ] **Step 8: Register the plugin**

In `packages/cli/src/typegen/run-plugins.ts`, after `kickRoutesTypegen()`:

```ts
import { kickClientTypegen } from './builtin/client'
// …
// After kick/routes — it resolves types out of the map that plugin emits.
plugins.push(kickClientTypegen())
```

- [ ] **Step 9: Run the full CLI suite**

Run: `cd packages/cli && pnpm exec vitest run`
Expected: PASS — the pre-existing 630 tests plus the new ones.

Existing typegen tests now run one more plugin. Any that assert the exact set of
emitted files or plugin results will need `kick/client` added to their
expectation — that is a real behavior change and the assertion should record it.
Do **not** silence such a failure by making the plugin conditional; the whole
point of this change is that the map is always current.

- [ ] **Step 10: Commit**

```bash
pnpm format
git add packages/cli/src/typegen/render/client.ts \
        packages/cli/src/typegen/builtin/client.ts \
        packages/cli/src/typegen/plugin.ts \
        packages/cli/src/typegen/runner.ts \
        packages/cli/src/typegen/run-plugins.ts \
        packages/cli/__tests__/client-render.test.ts \
        packages/cli/__tests__/client-plugin-skips.test.ts
git commit -m "feat(cli): emit a self-contained client route map from kick typegen"
```

---

### Task 5: End-to-end proof, docs, changeset

**Files:**

- Test: `packages/cli/__tests__/client-e2e.test.ts`
- Modify: `docs/guide/typed-client.md`
- Modify: `docs/guide/typed-client-recipes.md`
- Create: `.changeset/self-contained-client-route-map.md`

**Interfaces:**

- Consumes: everything above. Produces no new API.

- [ ] **Step 1: Write the failing end-to-end test**

```ts
/**
 * The claim this feature makes is falsifiable, so falsify it: a frontend
 * tsconfig with NO `experimentalDecorators`, NO `paths`, and
 * `verbatimModuleSyntax: true` — the exact shape that produced 6,457 errors in
 * #543 — must type-check against the emitted file.
 *
 * And the negative half matters just as much: a wrong path must still fail to
 * compile, or the map is not typing anything.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('the client route map, end to end', () => {
  it('type-checks in a frontend with none of the server tsconfig gymnastics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-client-e2e-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(
        join(dir, 'kick__client.d.ts'),
        `export interface KickApi {
  'GET /terms': { params: {}; body: unknown; query: unknown; response: { id: string }[]; contextKeys: never }
}
`,
      )
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            // The three settings #543 had to add — deliberately absent.
            verbatimModuleSyntax: true,
          },
          include: ['src', 'kick__client.d.ts'],
        }),
      )
      writeFileSync(
        join(dir, 'src/app.ts'),
        `import type { KickApi } from '../kick__client'
type Terms = KickApi['GET /terms']['response']
export const ids = (t: Terms) => t.map((x) => x.id)
`,
      )

      const tsc = join(process.cwd(), 'node_modules/typescript/bin/tsc')
      expect(() => execFileSync(process.execPath, [tsc, '--noEmit', '-p', dir])).not.toThrow()

      // Negative half: a route that does not exist must not compile.
      writeFileSync(
        join(dir, 'src/app.ts'),
        `import type { KickApi } from '../kick__client'
export type Nope = KickApi['GET /nope']
`,
      )
      expect(() => execFileSync(process.execPath, [tsc, '--noEmit', '-p', dir])).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run __tests__/client-e2e.test.ts`
Expected: PASS. This test asserts the _contract_, so it passes once the
renderer's output shape is right; it fails loudly if a future change
reintroduces an import or an ambient declaration.

- [ ] **Step 3: Document it in the typed-client guide**

Add a section to `docs/guide/typed-client.md` after the existing bridge
instructions:

````markdown
## Frontends outside the server's TypeScript program

The bridge above imports the server's generated route types, which reference
controller classes to infer responses. In one repo with a handful of
controllers that is free. At scale it is not: the frontend ends up compiling
the server's source graph, so its tsconfig needs `experimentalDecorators`,
`emitDecoratorMetadata`, and a `paths` fallback into server source — and its
typecheck slows down and grows to match the server's.

`kick typegen` removes the reference entirely. Alongside `kick__routes.ts` it
emits `.kickjs/types/kick__client.d.ts`, with every response type resolved to a
literal shape and **no imports at all**. The frontend needs one line:

```ts
import type { KickApi } from '../../../api/.kickjs/types/kick__client'

export const api = createClient<KickApi>({ baseUrl: '/api/v1' })
```

No decorator settings, no path aliases, no ambient bridge file. `kick typegen
--check` gates staleness in CI, exactly as with the other generated files.

::: warning Not refreshed by `kick dev`
Resolving the types builds a full TypeScript program over the server, which is
a build-step cost rather than a per-save one — so `kick dev` leaves this file
alone and everything else in `.kickjs/types/` keeps updating on save. Run
`kick typegen` (or let CI's `--check` remind you) after changing a response
shape. The ambient `KickRoutes.Api` the server itself uses is unaffected.
:::

::: tip Needs a compiler API
The pass uses TypeScript's compiler API, an optional peer dependency. TypeScript
7 ships no JS compiler API, so on TS 7 install the compatibility package:
`pnpm add -D @typescript/typescript6`. Without one, `kick typegen` prints a
warning and skips just this file.
:::
````

Add a matching pointer to `docs/guide/typed-client-recipes.md` so the recipe
page links to it rather than repeating it. All internal links must be relative.

- [ ] **Step 4: Write the changeset**

````bash
cat > .changeset/self-contained-client-route-map.md <<'EOF'
---
'@forinda/kickjs-cli': minor
---

`kick typegen`: a route map frontends can use without compiling the server

`KickRoutes.Api` infers response types by referencing controller classes, so a
frontend that wants `createClient<KickApi>` has to pull the server's source
graph into its own `tsc` run. On a 1,727-controller app that meant
`experimentalDecorators`, `emitDecoratorMetadata`, a `paths` fallback into
server source, five ambient imports — and a typecheck that went from 1.69s /
819 MB to 10.84s / 4.87 GB, per frontend, per CI run.

`kick typegen` now also emits `.kickjs/types/kick__client.d.ts`: every type
resolved to a literal shape, shared shapes hoisted, module-scoped, and with no
imports at all. The frontend needs one line:

```ts
import type { KickApi } from '../../../api/.kickjs/types/kick__client'
````

`kick typegen --check` gates staleness in CI. The file is not refreshed under
`kick dev` — resolving the types builds a full TypeScript program over the
server, which is a build-step cost, not a per-save one. Everything else in
`.kickjs/types/` keeps updating on save.

Needs a TypeScript compiler API, an optional peer dependency. TypeScript 7 ships
none, so install `@typescript/typescript6` there. Without one, `kick typegen`
warns and skips this file rather than failing.
EOF

````

- [ ] **Step 5: Verify the whole repo**

```bash
pnpm build && pnpm test && pnpm lint && pnpm lint:tokens && pnpm format:check && pnpm docs:build
````

Expected: all green. Report actual output — a skipped step is a failed step.

- [ ] **Step 6: Commit and open the PR**

```bash
pnpm format
git add docs .changeset packages/cli/__tests__/client-e2e.test.ts
git commit -m "docs(cli): document the self-contained client route map (#543)"
git push -u origin feat/client-route-map
gh pr create --base main --title "feat(cli): emit a route map frontends can use without compiling the server" --body-file /tmp/pr-body.md
```

The PR body goes through a temp file (see CLAUDE.md) and must close #543.

---

## Follow-ups this plan deliberately leaves open

1. **JSON-shaping** — `Date` → `string`, `undefined`-drop, `toJSON()` return
   types, `bigint` as an error. Affects the ambient map identically; fixing it
   in one place only would split the inference path this design is built to
   keep single. File as its own issue against both maps.
2. **`kickRpc` for the client map** — a `.d.ts` cannot carry a value. A sibling
   `kick__client.rpc.ts` is straightforward and needs no new inference.
3. **The somakwetu migration** — port the four frontends off the bridge and
   onto the emitted file once this ships. That is the change this work exists
   to make possible, and it is one import per frontend plus deleting the
   tsconfig workarounds.
