import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanProject, scanProjectIncremental } from '../src/typegen/scanner'

/**
 * Stage C — incremental (walk-free) scan driven by an exact delta.
 * The contract: `scanProjectIncremental(opts, delta)` must produce the
 * same ScanResult a full `scanProject` would, for add / change / remove,
 * while reading only the delta'd files.
 */
describe('scanProjectIncremental', () => {
  let root: string
  let src: string
  let cacheDir: string

  const write = (rel: string, body: string) => writeFile(join(src, rel), body)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kick-incr-'))
    src = join(root, 'src')
    cacheDir = join(root, '.kickjs', 'cache')
    await mkdir(join(src, 'users'), { recursive: true })
    await write(
      'users/users.controller.ts',
      `@Controller('/users')
export class UsersController {
  @Get('/:id') getUser() {}
}
`,
    )
    await write('users/users.service.ts', `@Service()\nexport class UsersService {}\n`)
    await write(
      'users/users.module.ts',
      `export class UsersModule {
  routes() { return [{ path: '/orgs/:orgId', controller: UsersController }] }
}
`,
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const opts = () => ({ root: src, cwd: root, cacheDir })

  it('falls back to a full scan when the cache is cold', async () => {
    const full = await scanProject({ root: src, cwd: root })
    // No cache written yet → incremental must transparently full-scan.
    const incr = await scanProjectIncremental(opts(), { changed: [], removed: [] })
    expect(incr).toEqual(full)
  })

  it('matches a full scan after a changed file (new class)', async () => {
    await scanProject(opts()) // warm cache
    const changed = join(src, 'users', 'users.service.ts')
    await write(
      'users/users.service.ts',
      `@Service()\nexport class UsersService {}\n@Repository()\nexport class UsersRepo {}\n`,
    )
    const fut = new Date(Date.now() + 5000)
    await utimes(changed, fut, fut)

    const incr = await scanProjectIncremental(opts(), { changed: [changed], removed: [] })
    const full = await scanProject({ root: src, cwd: root })
    expect(incr.classes).toEqual(full.classes)
    expect(incr.classes.map((c) => c.className)).toContain('UsersRepo')
  })

  it('matches a full scan after an added file', async () => {
    await scanProject(opts()) // warm cache
    await mkdir(join(src, 'orders'), { recursive: true })
    const added = join(src, 'orders', 'orders.controller.ts')
    await write(
      'orders/orders.controller.ts',
      `@Controller('/orders')\nexport class OrdersController {\n  @Post('/') create() {}\n}\n`,
    )

    const incr = await scanProjectIncremental(opts(), { changed: [added], removed: [] })
    const full = await scanProject({ root: src, cwd: root })
    expect(incr).toEqual(full)
    expect(incr.classes.map((c) => c.className)).toContain('OrdersController')
  })

  it('matches a full scan after a removed file', async () => {
    await scanProject(opts()) // warm cache
    const removed = join(src, 'users', 'users.service.ts')
    await rm(removed)

    const incr = await scanProjectIncremental(opts(), { changed: [], removed: [removed] })
    const full = await scanProject({ root: src, cwd: root })
    expect(incr).toEqual(full)
    expect(incr.classes.map((c) => c.className)).not.toContain('UsersService')
  })

  it('drops the mount prefix when the module file is deleted', async () => {
    await scanProject(opts()) // warm: route has /orgs/:orgId prefix
    const moduleFile = join(src, 'users', 'users.module.ts')
    await rm(moduleFile)

    const incr = await scanProjectIncremental(opts(), { changed: [], removed: [moduleFile] })
    const full = await scanProject({ root: src, cwd: root })
    expect(incr).toEqual(full)
    const route = incr.routes.find((r) => r.controller === 'UsersController')
    // Prefix gone → only the route's own `:id` param remains.
    expect(route?.pathParams).toEqual(['id'])
  })

  it('preserves cross-file mount-prefix params through an unrelated change', async () => {
    await scanProject(opts()) // warm
    // Touch the service (NOT the controller/module) — the controller's
    // mount-prefixed pathParams must still resolve from cached extracts.
    const changed = join(src, 'users', 'users.service.ts')
    await write('users/users.service.ts', `@Service()\nexport class UsersService { x = 1 }\n`)
    const fut = new Date(Date.now() + 5000)
    await utimes(changed, fut, fut)

    const incr = await scanProjectIncremental(opts(), { changed: [changed], removed: [] })
    const route = incr.routes.find((r) => r.controller === 'UsersController')
    expect(route?.pathParams).toEqual(['orgId', 'id'])
  })

  it('ignores delta entries that are not scannable (.d.ts, tests)', async () => {
    await scanProject(opts()) // warm
    const full = await scanProject({ root: src, cwd: root })
    const incr = await scanProjectIncremental(opts(), {
      changed: [join(src, 'users', 'users.d.ts'), join(src, 'users', 'x.test.ts')],
      removed: [],
    })
    expect(incr).toEqual(full)
  })
})
