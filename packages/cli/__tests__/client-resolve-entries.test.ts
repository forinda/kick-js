/**
 * The resolution step is where "the server already knows this" becomes a
 * literal type. It leans on a property worth stating: the emitted entry MUST
 * equal `KickRoutes.Api[key]`, because that is what makes the client route map
 * incapable of drifting from the ambient one (#543).
 *
 * The fixture is a miniature routes file with the shape typegen emits — module
 * plus `declare global` plus namespace — rather than a whole app, so a failure
 * points at resolution rather than at the scanner.
 *
 * @module @forinda/kickjs-cli/__tests__/client-resolve-entries.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveClientMap } from '../src/typegen/client/resolve-entries'

let dir: string
let routesFile: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kick-client-'))
  mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })

  // The compiler API is resolved from the PROJECT, so the fixture needs a
  // node_modules that reaches one. Pointing at this package's own is the
  // cheapest way to give it a real resolution root.
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'kick-client-fixture', private: true, version: '0.0.0' }),
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
      },
      include: ['.kickjs', 'src'],
    }),
  )
  writeFileSync(
    join(dir, 'src/term.ts'),
    'export interface Term { id: string; name: string; startsAt: Date }\n',
  )

  routesFile = join(dir, '.kickjs/types/kick__routes.ts')
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
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveClientMap', () => {
  it('resolves an entry to structure, with named shapes hoisted', async () => {
    const out = await resolveClientMap({
      projectDir: dir,
      compilerFrom: process.cwd(),
      routesFile,
      keys: ['GET /terms'],
    })

    const entry = out.entries.get('GET /terms')!
    expect(entry).toContain('response: __T0[]')
    expect(out.hoisted.join('\n')).toContain('startsAt: Date')

    // The point of the whole feature: nothing reaches back into src/.
    expect(entry).not.toContain('import')
    expect(entry).not.toContain('Term')
    expect(out.hoisted.join('\n')).not.toContain('src/term')
  })

  it('warns and skips a key the program does not have', async () => {
    const warnings: string[] = []
    const out = await resolveClientMap({
      projectDir: dir,
      compilerFrom: process.cwd(),
      routesFile,
      keys: ['GET /terms', 'GET /ghost'],
      onWarn: (m) => warnings.push(m),
    })

    expect(out.entries.has('GET /terms')).toBe(true)
    expect(out.entries.has('GET /ghost')).toBe(false)
    expect(warnings.join('\n')).toContain('GET /ghost')
  })

  it('refuses to emit anything when the routes file does not compile', async () => {
    // The failure this guards against produced 1,940 routes of `response: any`
    // and zero warnings, on a project whose dependencies had gone missing. A
    // map of `any` looks like a typed client and checks nothing, so it must
    // never be written — better no file than a file that lies.
    const broken = mkdtempSync(join(tmpdir(), 'kick-broken-'))
    try {
      mkdirSync(join(broken, '.kickjs/types'), { recursive: true })
      writeFileSync(
        join(broken, 'package.json'),
        JSON.stringify({ name: 'broken-fixture', private: true, version: '0.0.0' }),
      )
      writeFileSync(
        join(broken, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
          },
          include: ['.kickjs'],
        }),
      )
      const brokenRoutes = join(broken, '.kickjs/types/kick__routes.ts')
      writeFileSync(
        brokenRoutes,
        // The shape typegen emits, but the import cannot resolve — exactly what
        // an uninstalled dependency tree looks like.
        `import type { Term } from './does-not-exist'

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

      await expect(
        resolveClientMap({
          projectDir: broken,
          compilerFrom: process.cwd(),
          routesFile: brokenRoutes,
          keys: ['GET /terms'],
        }),
      ).rejects.toThrow(/type error|cannot be resolved|'any'/)
    } finally {
      rmSync(broken, { recursive: true, force: true })
    }
  })
})
