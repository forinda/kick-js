/**
 * Generated code must run on every runtime the framework supports.
 *
 * Two generators emitted Express-only code, and neither branched on the
 * project's runtime:
 *
 *   `kick g middleware` → `import type { Request, Response, NextFunction }
 *                          from 'express'`
 *   `kick g guard`      → `ctx.res.status(401).json(...)`
 *
 * Both are broken on a Fastify or h3 scaffold. `express` is not a dependency
 * there at all (the scaffold installs `fastify` + `@fastify/middie`), so the
 * import is a compile error on a freshly generated file. And `ctx.res` is the
 * ENGINE-NATIVE response: `FastifyReply` has no `.json()` — verified against
 * Fastify's own types — and h3's event has no `.status()`.
 *
 * Invisible until someone ran a non-Express project, because the default
 * runtime is Express.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateGuard } from '../src/generators/guard'
import { generateMiddleware } from '../src/generators/middleware'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kick-gen-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Source with comment lines removed — assertions target CODE, not prose. */
function codeOf(src: string): string {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
}

function readOnly(dir: string): string {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
  expect(files).toHaveLength(1)
  return readFileSync(join(files[0]!.parentPath ?? dir, files[0]!.name), 'utf8')
}

describe('kick g middleware', () => {
  it('does not import from express', async () => {
    const dir = tempDir()
    await generateMiddleware({ name: 'audit', outDir: dir })
    const src = readOnly(dir)
    // A Fastify / h3 scaffold has neither `express` nor `@types/express`.
    expect(src).not.toContain("from 'express'")
    expect(src).toContain("from 'node:http'")
  })

  it('types the handler from node, not the engine', async () => {
    const dir = tempDir()
    await generateMiddleware({ name: 'audit', outDir: dir })
    const src = readOnly(dir)
    expect(src).toContain('req: IncomingMessage')
    expect(src).toContain('res: ServerResponse')
  })
})

describe('kick g guard', () => {
  it('answers through ctx, not the engine-native response', async () => {
    const dir = tempDir()
    await generateGuard({ name: 'adminOnly', outDir: dir })
    const src = readOnly(dir)
    // `ctx.res.status(...).json(...)` is Express-only. Checked against code
    // only: the template deliberately NAMES the broken idiom in a comment so
    // the next editor knows why it is avoided.
    expect(codeOf(src)).not.toMatch(/ctx\.res\.status\(/)
    expect(src).toContain('ctx.problem.unauthorized(')
  })

  it('says why, so the next editor does not reach for ctx.res again', async () => {
    const dir = tempDir()
    await generateGuard({ name: 'adminOnly', outDir: dir })
    expect(readOnly(dir)).toMatch(/ENGINE-NATIVE/)
  })
})
