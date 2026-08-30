/**
 * Recursive response types, through the real resolution path.
 *
 * The unit-level expander harness does not reproduce this: it hands the
 * expander a type read straight off its own alias declaration, which renders
 * by name. The bug only appears once a type arrives the way a route's response
 * does — instantiated, with the alias stripped — so this test drives
 * `resolveClientMap` over a real project, like `client-e2e.test.ts` does.
 *
 * What it protects: a recursive type alias (zod v4's `JSONSchema`, or a
 * condition tree) is anonymous — a type alias to an object literal carries the
 * `__type` symbol, not the alias name — so nothing was hoistable and the walk
 * re-expanded it inline at every occurrence. Measured on a real app: one route
 * produced 1.66M depth-guard warnings, 4.4 GB, and a V8 abort; another emitted
 * a single 7,000-character line that bottomed out in `unknown` anyway.
 *
 * @module @forinda/kickjs-cli/__tests__/client-recursive-types.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveClientMap } from '../src/typegen/client/resolve-entries'
import type { ResolvedClientMap } from '../src/typegen/client/resolve-entries'

let dir: string
let map: ResolvedClientMap
let warnings: string[]

const KEY = 'GET /policies'

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kick-recursive-'))
  mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })

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

  // A condition tree: mutually recursive, and every member anonymous.
  writeFileSync(
    join(dir, 'src/policy.ts'),
    `export type Node =
  | { readonly all: readonly Node[] }
  | { readonly any: readonly Node[] }
  | { readonly not: Node }
  | { readonly p: string; readonly v: string }

export interface Policy {
  readonly id: string
  readonly when: Node
}
`,
  )

  const routesFile = join(dir, '.kickjs/types/kick__routes.ts')
  writeFileSync(
    routesFile,
    `import type { Policy } from '../../src/policy'

declare global {
  namespace KickRoutes {
    interface Api {
      '${KEY}': {
        params: {}
        body: unknown
        query: unknown
        response: Policy[]
        contextKeys: never
      }
    }
  }
}

export const kickRpc = {} as const
`,
  )

  warnings = []
  map = await resolveClientMap({
    projectDir: dir,
    compilerFrom: process.cwd(),
    routesFile,
    keys: [KEY],
    onWarn: (m) => warnings.push(m),
  })
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('recursive response types', () => {
  it('resolves without tripping the depth guard', () => {
    // 325 identical warnings for one route was the symptom that this had
    // degraded; 1.66M was the symptom that it had run away.
    expect(warnings).toEqual([])
  })

  it('hoists the recursive members instead of inlining them', () => {
    expect(map.hoisted.length).toBeGreaterThanOrEqual(3)
  })

  it('represents the recursion as a self-reference', () => {
    // This is the whole fix: the cycle terminates on a name. Without it the
    // walk duplicates the subtree at every level until it runs out of budget.
    const blocks = map.hoisted.join('\n')
    expect(blocks).toMatch(/interface __T\d+ \{[^}]*readonly all: readonly \(__T\d+/)
    expect(blocks).toMatch(/__T\d+ \| __T\d+/)
  })

  it('keeps the type exact rather than degrading it', () => {
    // `Policy` itself hoists, so the entry references it by name; the fields
    // live in the block. `unknown` anywhere in the response is the degradation
    // this guards against — the entry's own body/query are unknown by design,
    // so check the response and the blocks.
    const response = /response: ([^;]+);/.exec(map.entries.get(KEY)!)?.[1]
    expect(response).toMatch(/__T\d+\[\]/)
    const blocks = map.hoisted.join('\n')
    expect(blocks).toContain('readonly id: string')
    expect(blocks).not.toContain('unknown')
  })

  it('stays small — the failure mode was a duplicated blob', () => {
    // The real app emitted 7,000 characters for one such property.
    const longest = Math.max(...[...map.hoisted, map.entries.get(KEY)!].map((s) => s.length))
    expect(longest).toBeLessThan(1000)
  })
})
