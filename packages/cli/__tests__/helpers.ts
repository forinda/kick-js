/**
 * Shared helpers for the CLI E2E test suite.
 *
 * Each test fixture is a freshly-created temp directory that mimics a
 * minimal kick.js project. The CLI binary (`dist/cli.mjs`) is invoked
 * against this directory as a real subprocess so we exercise the
 * actual commander wiring, not just the generator functions.
 *
 * After running a command, tests can run `tsc --noEmit` against the
 * fixture to verify the generated files compile cleanly. This single
 * check catches the entire class of "scaffold emits broken code" bugs
 * without per-template assertions.
 *
 * @module @forinda/kickjs-cli/__tests__/helpers
 */

import { execSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Absolute path to the built CLI binary inside this package */
export const CLI_BIN = resolve(__dirname, '..', 'dist', 'cli.mjs')
/** Absolute path to the kickjs workspace root (so fixtures can resolve `@forinda/kickjs`) */
export const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..')

/**
 * Create a fresh temp directory containing the bare minimum a kick.js
 * project needs to run the CLI and `tsc --noEmit` against it:
 *
 * - `package.json` declaring `@forinda/kickjs` as a dep (resolved via
 *   the workspace `node_modules` link below)
 * - `tsconfig.json` with the typegen include patterns
 * - `node_modules` symlink chain that lets the project find the
 *   workspace's published packages
 *
 * Returns the absolute fixture path. Caller is responsible for cleanup
 * (call `cleanupFixture(dir)` in `afterEach`).
 */
export function createFixtureProject(name = 'kick-cli-test'): string {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`))

  // Minimal package.json — name + type + zero deps. The CLI doesn't
  // need anything installed to run; tsc resolves @forinda/kickjs via
  // a symlink we create below.
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '0.0.0',
        type: 'module',
      },
      null,
      2,
    ),
  )

  // Tsconfig matches what the scaffold templates emit so generated
  // files compile under the same conditions a real user would see.
  // Mirrors `packages/cli/src/generators/templates/project-config.ts`
  // (the tsconfig users get from `kick init`).
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2022'],
          types: ['node', 'vite/client'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          noEmit: true,
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src', '.kickjs/types/**/*.d.ts', '.kickjs/types/**/*.ts'],
      },
      null,
      2,
    ),
  )

  mkdirSync(join(dir, 'src'), { recursive: true })

  // Create a node_modules dir with a symlink to the workspace's
  // @forinda/kickjs source so tsc can resolve it. We use the source
  // directly (not the dist) to avoid needing a build step in tests.
  mkdirSync(join(dir, 'node_modules', '@forinda'), { recursive: true })
  const kickjsSrc = join(WORKSPACE_ROOT, 'packages', 'kickjs')
  execSync(`ln -sf "${kickjsSrc}" "${join(dir, 'node_modules', '@forinda', 'kickjs')}"`)
  // Some scaffolds also import from @forinda/kickjs-swagger
  const swaggerSrc = join(WORKSPACE_ROOT, 'packages', 'swagger')
  execSync(`ln -sf "${swaggerSrc}" "${join(dir, 'node_modules', '@forinda', 'kickjs-swagger')}"`)

  // Symlink @types/node and zod from the workspace so tsc can resolve
  // both the `types: ['node']` reference and any `import { z } from 'zod'`
  // that scaffolded DTOs use. Resolving via the workspace's pnpm store
  // means we don't need to install anything in the fixture.
  linkWorkspaceDep(dir, '@types/node')
  linkWorkspaceDep(dir, '@types/express')
  linkWorkspaceDep(dir, 'zod')
  linkWorkspaceDep(dir, 'vite')
  linkWorkspaceDep(dir, 'express')
  linkWorkspaceDep(dir, 'vitest')

  return dir
}

/**
 * Symlink a workspace dependency into a fixture's node_modules so tsc
 * can resolve it. Walks the workspace's pnpm store to find the actual
 * package directory and symlinks it directly. Best-effort — silently
 * skips if the package isn't found in the workspace.
 */
function linkWorkspaceDep(fixtureDir: string, pkgName: string): void {
  // pnpm uses a flat node_modules/.pnpm/<name>@<version>/node_modules/<name>
  // structure. We resolve via the workspace's top-level node_modules,
  // which has symlinks to the .pnpm store entries.
  const candidates = [
    join(WORKSPACE_ROOT, 'node_modules', pkgName),
    join(WORKSPACE_ROOT, 'packages', 'kickjs', 'node_modules', pkgName),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const target = pkgName.startsWith('@')
        ? (() => {
            const [scope, name] = pkgName.split('/')
            mkdirSync(join(fixtureDir, 'node_modules', scope), { recursive: true })
            return join(fixtureDir, 'node_modules', scope, name)
          })()
        : join(fixtureDir, 'node_modules', pkgName)
      try {
        execSync(`ln -sf "${candidate}" "${target}"`)
      } catch {
        // ignore
      }
      return
    }
  }
}

/** Recursively delete a fixture directory (best-effort, never throws) */
export function cleanupFixture(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore — temp dirs are eventually cleaned up by the OS
  }
}

/** Result of a CLI subprocess invocation */
export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run the built `kick` CLI against a fixture directory.
 *
 * Throws nothing — even non-zero exit codes are returned in the result
 * so tests can assert on failure modes (e.g. typegen collisions).
 */
export function runCli(cwd: string, args: string[]): CliResult {
  if (!existsSync(CLI_BIN)) {
    throw new Error(
      `CLI binary not found at ${CLI_BIN}. Run \`pnpm --filter @forinda/kickjs-cli build\` first.`,
    )
  }
  const result: SpawnSyncReturns<string> = spawnSync('node', [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  })
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/**
 * Run `tsc --noEmit` against a fixture project. Resolves the
 * workspace `tsc` so we don't need it installed in every fixture.
 */
export function runTsc(cwd: string): CliResult {
  // Find the typescript binary from the workspace root's node_modules
  const tscBin = resolve(WORKSPACE_ROOT, 'node_modules', '.pnpm', 'node_modules', '.bin', 'tsc')
  // Fallback to a direct path if the .pnpm shortcut doesn't exist
  const candidates = [tscBin, resolve(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsc')]
  const tsc = candidates.find((p) => existsSync(p))
  if (!tsc) {
    throw new Error(
      `tsc binary not found in workspace node_modules (tried: ${candidates.join(', ')})`,
    )
  }
  const result: SpawnSyncReturns<string> = spawnSync(tsc, ['--noEmit', '-p', cwd], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Assert that a CLI invocation succeeded; throws with diagnostic context if not */
export function assertCliOk(result: CliResult, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.exitCode}\n` +
        `stdout:\n${result.stdout}\n` +
        `stderr:\n${result.stderr}`,
    )
  }
}
