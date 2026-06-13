import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanProject } from '../src/typegen/scanner'

/**
 * Incremental cache behaviour for the typegen scanner. The cache must:
 *  1. produce byte-identical ScanResults whether or not it is enabled,
 *  2. skip readFile for files whose mtime+size signature is unchanged,
 *  3. re-read + re-extract a file whose signature changed,
 *  4. resolve cross-file mount-prefix params correctly from cache.
 */
describe('scanner persistent cache', () => {
  let root: string
  let src: string
  let cacheDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kick-scan-cache-'))
    src = join(root, 'src')
    cacheDir = join(root, '.kickjs', 'cache')
    await mkdir(join(src, 'users'), { recursive: true })
    await writeFile(
      join(src, 'users', 'users.controller.ts'),
      `@Controller('/users')
export class UsersController {
  @Get('/:id')
  getUser() {}
}
`,
    )
    await writeFile(
      join(src, 'users', 'users.service.ts'),
      `@Service()
export class UsersService {}
`,
    )
    await writeFile(
      join(src, 'users', 'users.module.ts'),
      `export class UsersModule {
  routes() {
    return [{ path: '/orgs/:orgId', controller: UsersController }]
  }
}
`,
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const opts = () => ({ root: src, cwd: root, cacheDir })

  it('produces an identical result with and without the cache', async () => {
    const uncached = await scanProject({ root: src, cwd: root })
    const cached = await scanProject(opts()) // cold, writes cache
    const warm = await scanProject(opts()) // warm, reads cache
    expect(cached).toEqual(uncached)
    expect(warm).toEqual(uncached)
  })

  it('resolves cross-file mount-prefix params from cache', async () => {
    await scanProject(opts()) // warm the cache
    const result = await scanProject(opts())
    const route = result.routes.find((r) => r.controller === 'UsersController')
    // Mount prefix `/orgs/:orgId` + route `/:id` → both params surfaced.
    expect(route?.pathParams).toEqual(['orgId', 'id'])
  })

  it('skips re-reading when the signature is unchanged (observable staleness)', async () => {
    const target = join(src, 'users', 'users.service.ts')
    const original = `@Service()
export class UsersService {}
`
    // Pin mtime to a clean integer-ms instant so it survives a utimes()
    // round-trip (Date has ms precision; raw fs mtimeMs may carry sub-ms
    // that utimes would truncate, perturbing the signature).
    const pinned = new Date(2020, 0, 1, 0, 0, 0, 0)
    await utimes(target, pinned, pinned)
    await scanProject(opts()) // cold: caches `UsersService` at the pinned sig

    // Rewrite with a SAME-BYTE-LENGTH body (rename UsersService → UsersServiZZ)
    // and re-pin the same mtime so the `mtimeMs:size` signature is identical.
    // A correct cache must NOT re-read → the warm scan still reports stale.
    const stale = original.replace('UsersService', 'UsersServiZZ')
    expect(stale.length).toBe(original.length)
    await writeFile(target, stale)
    await utimes(target, pinned, pinned)

    const warm = await scanProject(opts())
    const names = warm.classes.map((c) => c.className)
    expect(names).toContain('UsersService') // stale → proves no re-read
    expect(names).not.toContain('UsersServiZZ')
  })

  it('self-heals from a corrupt cache file (missing extract fields)', async () => {
    const truth = await scanProject({ root: src, cwd: root })
    await scanProject(opts()) // write a valid cache

    // Corrupt one entry: keep a valid sig but a structurally-broken
    // extract (no array fields). load() must reject it → cold re-scan.
    const cacheFile = join(cacheDir, 'scan.json')
    const doc = JSON.parse(await readFile(cacheFile, 'utf-8'))
    const firstKey = Object.keys(doc.files)[0]
    doc.files[firstKey].extract = { classes: 'not-an-array' }
    await writeFile(cacheFile, JSON.stringify(doc))

    const healed = await scanProject(opts())
    expect(healed).toEqual(truth)
  })

  it('re-extracts a file whose signature changed', async () => {
    await scanProject(opts()) // cold
    const changed = join(src, 'users', 'users.service.ts')
    await writeFile(
      changed,
      `@Service()
export class UsersService {}
@Repository()
export class UsersRepo {}
`,
    )
    // Bump mtime to guarantee a signature change even on coarse clocks.
    const future = new Date(Date.now() + 5000)
    await utimes(changed, future, future)

    const result = await scanProject(opts())
    // Fresh class only visible if the file was re-read → proves re-extract.
    expect(result.classes.map((c) => c.className)).toContain('UsersRepo')
  })

  it('writes no cache file when cacheDir is omitted (the --no-cache path)', async () => {
    // Mirrors runTypegen({ noCache: true }) → scanProject without cacheDir.
    const result = await scanProject({ root: src, cwd: root })
    expect(result.classes.length).toBeGreaterThan(0) // still scans correctly
    let exists = true
    try {
      await readFile(join(cacheDir, 'scan.json'), 'utf-8')
    } catch {
      exists = false
    }
    expect(exists).toBe(false) // nothing persisted
  })
})
