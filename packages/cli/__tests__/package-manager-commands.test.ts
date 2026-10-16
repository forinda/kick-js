/**
 * What the CLI prints and writes for each package manager: commands that run
 * as printed, and project files the manager needs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { execBin, runScript } from '../src/config'
import { resolveTypecheckBin } from '../src/commands/dev-typecheck'
import { generateDockerfile } from '../src/generators/templates/docker'
import { yarnrc } from '../src/generators/templates/project-config'
import { detectPackageManager } from '../src/utils/package-manager'

const dirs: string[] = []
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kick-pm-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('commands as each package manager runs them', () => {
  it('runs scripts with `run` where the bare form means something else', () => {
    expect(runScript('npm', 'dev')).toBe('npm run dev') // `npm dev` is not a command
    expect(runScript('bun', 'test')).toBe('bun run test') // `bun test` is Bun's runner
    expect(runScript('pnpm', 'dev')).toBe('pnpm dev')
    expect(runScript('yarn', 'build')).toBe('yarn build')
  })

  it('runs the project-local CLI, not a global one', () => {
    expect(execBin('npm', 'kick')).toBe('npx kick')
    expect(execBin('pnpm', 'kick')).toBe('pnpm exec kick')
    expect(execBin('yarn', 'kick')).toBe('yarn kick')
    expect(execBin('bun', 'kick')).toBe('bunx kick')
  })
})

describe('detectPackageManager', () => {
  it('takes the nearest lockfile, not the first kind found anywhere up the tree', () => {
    const root = tmp()
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    const app = join(root, 'apps', 'api')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'package-lock.json'), '{}')
    expect(detectPackageManager(app)).toBe('npm')
    expect(detectPackageManager(root)).toBe('pnpm')
  })

  it('defaults to npm', () => {
    expect(detectPackageManager(tmp())).toBe('npm')
  })
})

describe('resolveTypecheckBin', () => {
  const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  const withTsc = (dir: string) => {
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '.bin', tsc), '')
  }

  it('finds the type-checker a workspace installed at its root (npm, yarn, bun hoist it)', () => {
    const root = tmp()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['server'] }))
    withTsc(root)
    const server = join(root, 'server')
    mkdirSync(server)
    expect(resolveTypecheckBin(server)?.cmd).toBe(join(root, 'node_modules', '.bin', tsc))
  })

  it('finds it at a pnpm workspace root listing the project by glob', () => {
    const root = tmp()
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/*'\n\nonlyBuiltDependencies:\n  - esbuild\n",
    )
    withTsc(root)
    const app = join(root, 'apps', 'api')
    mkdirSync(app, { recursive: true })
    expect(resolveTypecheckBin(app)?.cmd).toBe(join(root, 'node_modules', '.bin', tsc))
    // A list under another key names no members.
    mkdirSync(join(root, 'esbuild'))
    expect(resolveTypecheckBin(join(root, 'esbuild'))).toBeNull()
  })

  it('ignores a parent that declares a workspace the project is not a member of', () => {
    const parent = tmp() // e.g. a planted /tmp/package.json
    writeFileSync(join(parent, 'package.json'), JSON.stringify({ workspaces: ['other'] }))
    withTsc(parent)
    const project = join(parent, 'app')
    mkdirSync(project)
    expect(resolveTypecheckBin(project)).toBeNull()
  })

  it('stops at the first package.json above, even if a workspace lists the project further up', () => {
    const outer = tmp()
    writeFileSync(join(outer, 'package.json'), JSON.stringify({ workspaces: ['**'] }))
    withTsc(outer)
    const middle = join(outer, 'middle')
    mkdirSync(join(middle, 'app'), { recursive: true })
    writeFileSync(join(middle, 'package.json'), '{}')
    expect(resolveTypecheckBin(join(middle, 'app'))).toBeNull()
  })

  it("never runs one from a parent folder that isn't the project's workspace", () => {
    const parent = tmp()
    withTsc(parent) // e.g. a node_modules/.bin someone left in /tmp
    const project = join(parent, 'app')
    mkdirSync(project)
    writeFileSync(join(project, 'package.json'), '{}')
    expect(resolveTypecheckBin(project)).toBeNull()
  })
})

describe('Yarn 2+ and older Bun', () => {
  it('turns Plug-n-Play off for Yarn 2+ only', () => {
    expect(yarnrc('yarn', 'yarn@4.5.0')).toBe('nodeLinker: node-modules\n')
    expect(yarnrc('yarn', 'yarn@1.22.22')).toBeUndefined()
    expect(yarnrc('npm', 'npm@11.0.0')).toBeUndefined()
  })

  it('writes a Dockerfile Yarn 2+ can install with', () => {
    const file = generateDockerfile('api', 'yarn', 'app', 'yarn@4.5.0')
    expect(file).toContain('COPY .yarnrc.yml ./')
    expect(file).toContain('yarn install --immutable')
    expect(file).toContain('yarn workspaces focus --all --production')
    expect(file).not.toContain('--frozen-lockfile')
    expect(generateDockerfile('api', 'yarn', 'app', 'yarn@1.22.22')).toContain(
      'yarn install --production --frozen-lockfile',
    )
  })

  it('installs everything on Yarn 2 and 3, which lack `workspaces focus` by default', () => {
    const file = generateDockerfile('api', 'yarn', 'app', 'yarn@3.8.7')
    expect(file).toContain('yarn install --immutable')
    expect(file).not.toContain('workspaces focus')
  })

  it('copies the lockfile of the chosen package manager, for every project kind', () => {
    for (const kind of ['api', 'inertia'] as const) {
      expect(generateDockerfile(kind, 'pnpm', 'app')).toContain('COPY pnpm-lock.yaml ./')
      expect(generateDockerfile(kind, 'pnpm', 'app')).not.toContain('package-lock.json')
    }
  })

  it('gives a SQLite file a writable /app/data to mount a volume on', () => {
    const file = generateDockerfile('inertia', 'npm', 'app')
    expect(file).toContain('docker run -v app-data:/app/data')
    expect(file).toMatch(/RUN mkdir -p data && chown node:node data\nUSER node/)
  })

  it("copies the lockfile the project's Bun writes", () => {
    expect(generateDockerfile('api', 'bun', 'app', 'bun@1.1.38')).toContain('COPY bun.lockb ./')
    expect(generateDockerfile('api', 'bun', 'app', 'bun@1.2.5')).toContain('COPY bun.lock ./')
  })
})
