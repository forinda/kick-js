/**
 * `kick typecheck` must not report errors from stale generated types.
 *
 * `kick dev` runs typegen on startup; `kick typecheck` did not. So the moment a
 * handler is renamed or a module deleted without the dev server running, the
 * check fails against `.kickjs/types` describing routes that no longer exist —
 * and the most confusing of those errors point at correct, current source and
 * claim a method that does exist is missing, because the stale `KickRoutes`
 * namespace has no entry for it. A pre-commit hook or a fresh clone hits this
 * every time, since neither has run the dev server.
 *
 * Spawns the real CLI against a real project, because the bug lives in the
 * ordering of two commands rather than in any single function.
 *
 * @module @forinda/kickjs-cli/__tests__/typecheck-refreshes-types.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(__dirname, '..', 'bin.js')
const REPO = resolve(__dirname, '..', '..', '..')

let dir: string
/**
 * Set once the fixture actually reproduces the bug.
 *
 * Asserted rather than used to skip: an unmet prerequisite used to leave both
 * tests passing while exercising nothing, which is the failure mode this file
 * exists to prevent elsewhere.
 */
let ready = false
let why = 'not initialised'

function kick(args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
  })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

beforeAll(() => {
  // The package directory, not the `.bin` shim: pnpm's shim computes its base
  // from `$0` and so cannot be symlinked into another tree.
  const tsPkg = join(REPO, 'node_modules', 'typescript')
  const tsc = existsSync(tsPkg) ? realpathSync(tsPkg) : ''
  // The workspace package itself, not a root node_modules link — pnpm does not
  // create one, and guarding on a path that never exists made both tests below
  // pass vacuously while asserting nothing.
  const kickjs = join(REPO, 'packages', 'kickjs')
  if (!tsc || !existsSync(join(tsc, 'bin', 'tsc')) || !existsSync(kickjs)) {
    why = `missing prerequisite: typescript at ${tsc || '(unresolved)'} or ${kickjs}`
    return
  }

  dir = mkdtempSync(join(tmpdir(), 'kick-stale-'))
  mkdirSync(join(dir, 'src', 'modules', 'hello'), { recursive: true })
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
  mkdirSync(join(dir, 'node_modules', '@forinda'), { recursive: true })
  // realpath, not the .bin shim: that shim is itself a relative symlink into
  // .pnpm, which resolves to nothing from a temp directory.
  // A one-line shim with an absolute require, so it works wherever the fixture
  // lives. `resolveTypecheckBin` looks for `node_modules/.bin/tsc`.
  const shim = join(dir, 'node_modules', '.bin', 'tsc')
  writeFileSync(shim, `#!/usr/bin/env node\nrequire(${JSON.stringify(join(tsc, 'bin', 'tsc'))})\n`)
  chmodSync(shim, 0o755)
  symlinkSync(realpathSync(kickjs), join(dir, 'node_modules', '@forinda', 'kickjs'))

  writeFileSync(
    join(dir, 'src', 'modules', 'hello', 'hello.controller.ts'),
    `import { Controller, Get } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

@Controller()
export class HelloController {
  @Get('/hello/list')
  list(_ctx: RequestContext) {
    return [{ id: '1' }]
  }
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
        lib: ['ES2022'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        noEmit: true,
      },
      include: ['src', '.kickjs/types/**/*.d.ts', '.kickjs/types/**/*.ts'],
    }),
  )
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'stale-fx', private: true, type: 'module' }),
  )

  const generated = kick(['typegen'])
  const routes = join(dir, '.kickjs', 'types', 'kick__routes.ts')
  if (!existsSync(routes)) {
    why = `kick typegen emitted no routes file. Output:\n${generated}`
    return
  }
  if (!readFileSync(routes, 'utf8').includes("['list']")) {
    why = `routes file does not reference the handler:\n${readFileSync(routes, 'utf8').slice(0, 400)}`
    return
  }

  // Rename the handler WITHOUT regenerating: the generated types are now stale.
  const controller = join(dir, 'src', 'modules', 'hello', 'hello.controller.ts')
  writeFileSync(controller, readFileSync(controller, 'utf8').replace('list(_ctx', 'index(_ctx'))
  ready = true
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('kick typecheck against stale generated types', () => {
  it('has a fixture that actually reproduces staleness', () => {
    expect(ready, why).toBe(true)
  })

  it('reports the stale error when typegen is skipped', () => {
    // Proves the fixture actually reproduces the bug. Without this the test
    // below passes for any reason at all, including tsc failing to launch.
    const out = kick(['typecheck', '--no-typegen'])
    expect(out, out).toContain("Property 'list' does not exist")
  })

  it('refreshes the types first, so the stale error never surfaces', () => {
    const out = kick(['typecheck'])
    expect(out).not.toContain("Property 'list' does not exist")
    expect(out).not.toContain('error TS')
  })
})
