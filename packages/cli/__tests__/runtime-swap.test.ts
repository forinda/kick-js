import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { swapConfigRuntime, swapRuntime } from '../src/scaffold/runtime-swap'
import { planRuntimePackages } from '../src/commands/runtime'

// The entry files `kick new --template rest --packages swagger` writes.
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures/runtime-swap', `${name}.ts.txt`), 'utf-8')
const express = fixture('express')
const h3 = fixture('h3')

/** Import lines sorted, so a different placement of the same imports compares equal. */
const normalized = (source: string) => {
  // The fixtures' apps are named after their engine (`app-express`, `app-h3`).
  const lines = source.replace(/app-(express|h3)/g, 'app').split('\n')
  const imports = lines.filter((l) => l.startsWith('import ')).toSorted()
  return [imports, lines.filter((l) => !l.startsWith('import '))]
}

describe('swapRuntime', () => {
  it("turns kick new's Express app into its h3 app", () => {
    const result = swapRuntime(express, 'express', 'h3')
    expect(result.manual).toEqual([])
    expect(normalized(result.source)).toEqual(normalized(h3))
    expect(result.source).not.toMatch(/expressRuntime|express\.json|from 'express'/)
  })

  it('and back again', () => {
    const result = swapRuntime(h3, 'h3', 'express')
    expect(result.manual).toEqual([])
    expect(normalized(result.source)).toEqual(normalized(express))
  })

  it('moves between Fastify and h3 without touching middlewares', () => {
    const fastify = swapRuntime(h3, 'h3', 'fastify').source
    expect(fastify).toContain('runtime: fastifyRuntime()')
    expect(fastify).toContain("import { fastifyRuntime } from '@forinda/kickjs/fastify'")
    expect(fastify).not.toContain('h3Runtime')
    expect(fastify).not.toContain('express')
  })

  it('keeps an import still used elsewhere, and reports dropped runtime options', () => {
    const source = express
      .replace('runtime: expressRuntime()', 'runtime: expressRuntime({ trustProxy: true })')
      .replace('requestLogger(),', 'requestLogger(),\n    express.urlencoded(),')
    const result = swapRuntime(source, 'express', 'fastify')
    expect(result.source).toContain('express.urlencoded()')
    expect(result.source).toContain("import express from 'express'")
    expect(result.source).not.toContain('express.json()')
    expect(result.manual.join('\n')).toMatch(/trustProxy: true/)
  })

  it('follows an aliased import of the old factory', () => {
    const source = express
      .replace('expressRuntime }', 'expressRuntime as er }')
      .replace('runtime: expressRuntime()', 'runtime: er()')
    const result = swapRuntime(source, 'express', 'h3')
    expect(result.blocked).toBe(false)
    expect(result.source).toContain('runtime: h3Runtime()')
    expect(result.source).not.toMatch(/\ber\b|expressRuntime/)
  })

  it("stops, changing nothing, when runtime: isn't a call to the old factory", () => {
    for (const value of ['runtime,', 'runtime: chooseRuntime(),', 'runtime: dev ? a() : b(),']) {
      const source = express.replace('runtime: expressRuntime(),', value)
      const result = swapRuntime(source, 'express', 'h3')
      expect(result.blocked).toBe(true)
      expect(result.source).toBe(source)
      expect(result.manual[0]).toMatch(/isn't a call to expressRuntime/)
    }
  })

  it("removes kick's body-parser comment with express.json(), and keeps the user's", () => {
    const source = express.replace(
      '    // Express needs a body parser; Fastify and h3 parse bodies natively.\n',
      '    // TODO: rate limiter here\n    // Express needs a body parser; Fastify and h3 parse bodies natively.\n',
    )
    const result = swapRuntime(source, 'express', 'fastify').source
    expect(result).toContain('// TODO: rate limiter here')
    expect(result).not.toContain('Express needs a body parser')
    const own = express.replace(
      '    // Express needs a body parser; Fastify and h3 parse bodies natively.\n',
      '    // parse JSON bodies\n',
    )
    expect(swapRuntime(own, 'express', 'fastify').source).toContain('// parse JSON bodies')
  })

  it('adds runtime: when bootstrap() has none, and asks when there is no bootstrap()', () => {
    const bare =
      "import { bootstrap } from '@forinda/kickjs'\nexport const app = await bootstrap({\n  modules,\n})\n"
    expect(swapRuntime(bare, 'express', 'h3').source).toContain(
      '  runtime: h3Runtime(),\n  modules,',
    )
    const none = swapRuntime('export const x = 1\n', 'express', 'h3')
    expect(none.source).toBe('export const x = 1\n')
    expect(none.manual[0]).toMatch(/No bootstrap/)
  })
})

describe('swapConfigRuntime', () => {
  it("rewrites the exported config's runtime, not a comment that mentions one", () => {
    const source =
      "// was runtime: 'express' before the move\nexport default defineConfig({\n  runtime: 'express',\n})"
    expect(swapConfigRuntime(source, 'h3')).toBe(
      "// was runtime: 'express' before the move\nexport default defineConfig({\n  runtime: 'h3',\n})",
    )
  })

  it('adds runtime when the config has none, and gives up without a config object', () => {
    expect(swapConfigRuntime('export default defineConfig({\n  pattern: "rest",\n})', 'h3')).toBe(
      'export default defineConfig({\n  runtime: \'h3\',\n  pattern: "rest",\n})',
    )
    expect(swapConfigRuntime('export default defineConfig({})', 'h3')).toBe(
      "export default defineConfig({ runtime: 'h3' })",
    )
    expect(swapConfigRuntime('export default config', 'h3')).toBeNull()
  })
})

describe('planRuntimePackages', () => {
  const plan = (
    from: 'express' | 'fastify' | 'h3',
    to: 'express' | 'fastify' | 'h3',
    installed: string[],
    uploads = false,
    imported: string[] = [],
  ) =>
    planRuntimePackages({
      from,
      to,
      installed: new Set(installed),
      uploads,
      imported: (name) => imported.includes(name),
    })

  it('swaps the engine peers', () => {
    expect(plan('express', 'h3', ['express', '@types/express'])).toEqual({
      toAdd: ['h3@^2', 'serve-static'],
      toAddDev: [],
      toRemove: ['express', '@types/express'],
      stillImported: [],
    })
  })

  it('swaps the upload driver when routes take uploads', () => {
    const toFastify = plan('express', 'fastify', ['express', 'multer', '@types/multer'], true)
    expect(toFastify.toAdd).toContain('@fastify/multipart')
    expect(toFastify.toRemove).toEqual(['express', 'multer', '@types/multer'])

    const toExpress = plan('fastify', 'express', ['fastify', '@fastify/multipart'], true)
    expect(toExpress.toAdd).toEqual(['express', 'multer'])
    expect(toExpress.toAddDev).toEqual(['@types/express', '@types/multer'])
    expect(toExpress.toRemove).toContain('@fastify/multipart')

    // h3 parses multipart itself: the old driver goes, nothing comes.
    const toH3 = plan('fastify', 'h3', ['fastify', '@fastify/multipart', 'serve-static'], true)
    expect(toH3.toAdd).toEqual(['h3@^2'])
    expect(toH3.toRemove).toContain('@fastify/multipart')
    expect(toH3.toRemove).not.toContain('serve-static')
  })

  it('keeps a package code still imports, and adds nothing already installed', () => {
    const result = plan('express', 'fastify', ['express', 'fastify'], false, ['express'])
    expect(result.stillImported).toEqual(['express'])
    expect(result.toRemove).not.toContain('express')
    expect(result.toAdd).not.toContain('fastify')
  })
})
