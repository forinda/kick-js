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

it('finds the type-checker a workspace installed at its root (npm, yarn, bun hoist it)', () => {
  const root = tmp()
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'),
    '',
  )
  const server = join(root, 'server')
  mkdirSync(server)
  expect(resolveTypecheckBin(server)?.kind).toBe('tsc')
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

  it("copies the lockfile the project's Bun writes", () => {
    expect(generateDockerfile('api', 'bun', 'app', 'bun@1.1.38')).toContain('COPY bun.lockb ./')
    expect(generateDockerfile('api', 'bun', 'app', 'bun@1.2.5')).toContain('COPY bun.lock ./')
  })
})
