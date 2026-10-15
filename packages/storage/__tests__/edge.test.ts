import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

/** Every module the main entry imports, followed through relative imports. */
async function importGraph(file: string, seen = new Map<string, string[]>()) {
  if (seen.has(file)) return seen
  const source = await readFile(file, 'utf8')
  const specifiers = [...source.matchAll(/^(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm)]
    // `import type` and `export type` vanish at build time.
    .filter((m) => !/^(?:import|export)\s+type\s/.test(m[0]))
    .map((m) => m[1])
  seen.set(file, specifiers)
  for (const spec of specifiers) {
    if (spec.startsWith('.')) await importGraph(join(dirname(file), `${spec}.ts`), seen)
  }
  return seen
}

it('the main entry imports nothing Node-only, so it runs on edge runtimes', async () => {
  const graph = await importGraph(join(import.meta.dirname, '../src/index.ts'))
  const nodeOnly = [...graph].flatMap(([file, specs]) =>
    specs.filter((s) => s.startsWith('node:')).map((s) => `${file}: ${s}`),
  )
  expect(nodeOnly).toEqual([])
  // And it was really followed: s3 and memory are in it.
  expect([...graph.keys()].some((f) => f.endsWith('s3.ts'))).toBe(true)
})
