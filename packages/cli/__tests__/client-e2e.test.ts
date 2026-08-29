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
 * The checker used here is the repo's own `tsc` — TypeScript 7 — not the
 * TypeScript 6 compiler API the generator runs on. That is the real
 * cross-version pairing an adopter gets.
 *
 * @module @forinda/kickjs-cli/__tests__/client-e2e.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { resolveClientMap } from '../src/typegen/client/resolve-entries'
import { renderClient } from '../src/typegen/render/client'

let server: string
let web: string

/** The repo's TypeScript 7 binary — what an adopter's frontend actually runs. */
const TSC = resolve(process.cwd(), '../../node_modules/typescript/bin/tsc')

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

  it('emits a file with no imports and no ambient declarations', () => {
    const emitted = require('node:fs').readFileSync(join(web, 'kick__client.d.ts'), 'utf-8')
    const code = emitted
      .split('\n')
      .filter((line: string) => !line.trimStart().startsWith('//'))
      .join('\n')

    expect(code).not.toContain('import ')
    expect(code).not.toContain('declare global')
    expect(code).not.toContain('src/term')
    expect(emitted).toContain('export interface KickApi')
  })

  it('type-checks in a frontend with none of the server tsconfig gymnastics', () => {
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { KickApi } from '../kick__client'

type Terms = KickApi['GET /terms']['response']

export const ids = (terms: Terms): string[] => terms.map((t) => t.id)
export const credits = (terms: Terms): (number | undefined)[] => terms.map((t) => t.credits)
`,
    )

    const { ok, output } = typecheckWeb()
    expect(output).toBe('')
    expect(ok).toBe(true)
  })

  it('still rejects a route that does not exist', () => {
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { KickApi } from '../kick__client'

export type Nope = KickApi['GET /nope']
`,
    )

    expect(typecheckWeb().ok).toBe(false)
  })

  it('still rejects a field the response does not have', () => {
    writeFileSync(
      join(web, 'src/app.ts'),
      `import type { KickApi } from '../kick__client'

type Terms = KickApi['GET /terms']['response']

export const bad = (terms: Terms) => terms.map((t) => t.nonexistent)
`,
    )

    expect(typecheckWeb().ok).toBe(false)
  })
})
