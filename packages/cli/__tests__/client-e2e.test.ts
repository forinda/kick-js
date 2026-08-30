/**
 * The claim this feature makes is falsifiable, so falsify it.
 *
 * #543 measured a frontend needing `experimentalDecorators`,
 * `emitDecoratorMetadata`, a `@/*` fallback into server source, and five
 * ambient imports before it would compile — 6,457 errors down to 1, at 10.84s
 * and 4.87 GB. This test builds the opposite: a frontend tsconfig with NONE of
 * those, plus `verbatimModuleSyntax: true` (the setting that collided with a
 * server dependency's ambient `const enum`), and compiles it against the real
 * emitted file.
 *
 * The negative half matters as much: a route that does not exist must still
 * fail to compile, or the map is not typing anything.
 *
 * Resolved through `require.resolve` rather than a path relative to
 * `process.cwd()`: vitest can be invoked from the repo root with `--root`,
 * and a cwd-relative guess then points outside the repo entirely.
 *
 * The checker used here is the repo's own `tsc` — TypeScript 7 — not the
 * TypeScript 6 compiler API the generator runs on. That is the real
 * cross-version pairing an adopter gets.
 *
 * @module @forinda/kickjs-cli/__tests__/client-e2e.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { resolveClientMap } from '../src/typegen/client/resolve-entries'
import { renderClient } from '../src/typegen/render/client'

let server: string
let web: string

/** The repo's TypeScript 7 binary — what an adopter's frontend actually runs. */
const TSC = (() => {
  // Not `resolve('typescript/bin/tsc')`: TypeScript 7's `exports` map does not
  // expose that subpath. Go through the manifest and read the declared bin.
  const req = createRequire(import.meta.url)
  const pkgPath = req.resolve('typescript/package.json')
  const bin = JSON.parse(readFileSync(pkgPath, 'utf-8')).bin
  return join(dirname(pkgPath), typeof bin === 'string' ? bin : bin.tsc)
})()

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'kick-client-e2e-'))
  server = join(root, 'server')
  web = join(root, 'web')
  mkdirSync(join(server, '.kickjs/types'), { recursive: true })
  mkdirSync(join(server, 'src'), { recursive: true })
  mkdirSync(join(web, 'src'), { recursive: true })

  writeFileSync(
    join(server, 'package.json'),
    JSON.stringify({ name: 'e2e-server', private: true, version: '0.0.0' }),
  )
  writeFileSync(
    join(server, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
      },
      include: ['.kickjs', 'src'],
    }),
  )
  writeFileSync(
    join(server, 'src/term.ts'),
    'export interface Term { id: string; name: string; credits?: number }\n',
  )

  const routesFile = join(server, '.kickjs/types/kick__routes.ts')
  writeFileSync(
    routesFile,
    `import type { Term } from '../../src/term'

declare global {
  namespace KickRoutes {
    interface Api {
      'GET /terms': {
        params: {}
        body: unknown
        query: unknown
        response: Term[]
        contextKeys: never
      }
    }
  }
}

export const kickRpc = {} as const
`,
  )

  // The real pipeline — not a hand-written stand-in for its output.
  const keys = ['GET /terms']
  const map = await resolveClientMap({
    projectDir: server,
    compilerFrom: process.cwd(),
    routesFile,
    keys,
  })
  writeFileSync(join(web, 'kick__client.d.ts'), renderClient(map, keys))

  writeFileSync(
    join(web, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        // The settings #543 had to add are deliberately absent:
        // no experimentalDecorators, no emitDecoratorMetadata, no paths.
        verbatimModuleSyntax: true,
      },
      include: ['src', 'kick__client.d.ts'],
    }),
  )
})

afterAll(() => {
  if (server) rmSync(join(server, '..'), { recursive: true, force: true })
})

/** Typecheck the web project with TypeScript 7; return stdout on failure. */
function typecheckWeb(): { ok: boolean; output: string } {
  try {
    execFileSync(process.execPath, [TSC, '--noEmit', '-p', web], { encoding: 'utf-8' })
    return { ok: true, output: '' }
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string }
    return { ok: false, output: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

describe('the client route map, end to end', () => {
  it('has a TypeScript 7 binary to check against', () => {
    // Guards the whole file: a missing tsc would make every assertion below
    // pass or fail for the wrong reason.
    expect(existsSync(TSC)).toBe(true)
  })

  it('emits a file with no imports, and only the namespace globally', () => {
    const emitted = require('node:fs').readFileSync(join(web, 'kick__client.d.ts'), 'utf-8')
    const code = emitted
      .split('\n')
      .filter((line: string) => !line.trimStart().startsWith('//'))
      .join('\n')

    // No imports is the load-bearing one: an import is a dependency on the
    // server's program, which is the thing being removed.
    expect(code).not.toContain('import ')
    expect(code).not.toContain('src/term')
    // The ambient surface is exactly one namespace. The hoisted shapes stay
    // module-local — see the leak test below.
    expect(code).toContain('namespace KickClientApi')
    expect(emitted).toContain('namespace KickClientApi')
    expect(emitted).toContain('export type { Api }')
  })

  it('type-checks in a frontend with none of the server tsconfig gymnastics', () => {
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { Api as KickApi } from '../kick__client'

type Terms = KickApi['GET /terms']['response']

export const ids = (terms: Terms): string[] => terms.map((t) => t.id)
export const credits = (terms: Terms): (number | undefined)[] => terms.map((t) => t.credits)
`,
    )

    const { ok, output } = typecheckWeb()
    expect(output).toBe('')
    expect(ok).toBe(true)
  })

  it('is usable with no import at all, via the ambient namespace', () => {
    // The reason the map is ambient as well as exported: a frontend that puts
    // this file in its tsconfig "include" needs no bridge file and no import
    // line — `KickClientApi.Api` is just there.
    writeFileSync(
      join(web, 'src/app.ts'),
      `type Terms = KickClientApi.Api['GET /terms']['response']

export const ids = (terms: Terms): string[] => terms.map((t) => t.id)
`,
    )

    const { ok, output } = typecheckWeb()
    expect(output).toBe('')
    expect(ok).toBe(true)
  })

  it('does not leak its hoisted shapes into the consuming global scope', () => {
    // Emitting the hoisted interfaces at the top level would make every
    // `__T<n>` global in the frontend — 86 of them on a real app.
    writeFileSync(join(web, 'src/app.ts'), 'export type Leaked = __T0\n')
    expect(typecheckWeb().ok).toBe(false)
  })

  it('compiles before the first route exists', () => {
    // A project with no routes yet is the scaffold's first moment. The empty
    // branch used to re-export `Api` from its own filename, which TypeScript
    // rejects with `TS2303: Circular definition of import alias` — so a fresh
    // project emitted a file that did not compile.
    writeFileSync(
      join(web, 'kick__client.d.ts'),
      renderClient({ entries: new Map(), hoisted: [] }, []),
    )
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { Api } from '../kick__client'

export type Keys = keyof Api
export type Ambient = keyof KickClientApi.Api
`,
    )

    const { ok, output } = typecheckWeb()
    expect(output).toBe('')
    expect(ok).toBe(true)
  })

  it('still rejects a route that does not exist', () => {
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { Api as KickApi } from '../kick__client'

export type Nope = KickApi['GET /nope']
`,
    )

    expect(typecheckWeb().ok).toBe(false)
  })

  it('still rejects a field the response does not have', () => {
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { Api as KickApi } from '../kick__client'

type Terms = KickApi['GET /terms']['response']

export const bad = (terms: Terms) => terms.map((t) => t.nonexistent)
`,
    )

    expect(typecheckWeb().ok).toBe(false)
  })
})
