import 'reflect-metadata'
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checkDecoratorTsConfig,
  checkEnvWiring,
  checkExpressInstalled,
  checkKickJsInstalled,
  checkReflectMetadata,
  defineDoctorCheck,
  defineDoctorExtension,
  runChecks,
  type DoctorContext,
} from '../src/commands/doctor'

// ── helpers ───────────────────────────────────────────────────────────

/**
 * Temp-dir tracking with afterEach cleanup. Earlier revisions called
 * `cleanup(dir)` at the tail of each `it` block, but any failing
 * assertion short-circuits and leaks the directory in the OS temp
 * folder. Tracking + global afterEach guarantees cleanup regardless
 * of test outcome.
 */
const trackedDirs: string[] = []

function tempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-doctor-'))
  trackedDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }
  return dir
}

afterEach(() => {
  while (trackedDirs.length > 0) {
    const dir = trackedDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows sometimes holds the lock briefly; tolerate.
    }
  }
})

function ctx(cwd: string, overrides: Partial<DoctorContext> = {}): DoctorContext {
  const pkgPath = join(cwd, 'package.json')
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf-8')) : null
  return { cwd, pkg, tsconfig: null, ...overrides }
}

// ── checkKickJsInstalled ──────────────────────────────────────────────

describe('checkKickJsInstalled', () => {
  it('passes when @forinda/kickjs is in dependencies', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        name: 'x',
        dependencies: { '@forinda/kickjs': '^5.0.0' },
      }),
    })
    const r = checkKickJsInstalled(ctx(dir))
    expect(r.status).toBe('pass')
    expect(r.message).toBe('^5.0.0')
  })

  it('fails when @forinda/kickjs is missing', () => {
    const dir = tempProject({ 'package.json': JSON.stringify({ name: 'x', dependencies: {} }) })
    const r = checkKickJsInstalled(ctx(dir))
    expect(r.status).toBe('fail')
    expect(r.fix).toContain('kick new')
  })

  it('warns when package.json is missing', () => {
    const dir = tempProject({})
    const r = checkKickJsInstalled(ctx(dir))
    expect(r.status).toBe('warn')
  })
})

// ── checkReflectMetadata ──────────────────────────────────────────────

describe('checkReflectMetadata', () => {
  it('passes when reflect-metadata is in any dep section', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        dependencies: { 'reflect-metadata': '^0.2.0' },
      }),
    })
    expect(checkReflectMetadata(ctx(dir)).status).toBe('pass')
  })

  it('fails when reflect-metadata is missing', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }),
    })
    const r = checkReflectMetadata(ctx(dir))
    expect(r.status).toBe('fail')
    expect(r.fix).toContain('reflect-metadata')
  })
})

// ── checkExpressInstalled ─────────────────────────────────────────────

describe('checkExpressInstalled', () => {
  it('fails when @forinda/kickjs is present but express is not', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        dependencies: { '@forinda/kickjs': '^5.0.0' },
      }),
    })
    const r = checkExpressInstalled(ctx(dir))
    expect(r?.status).toBe('fail')
    expect(r?.fix).toContain('express')
  })

  it('passes when both kickjs and express are installed', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        dependencies: { '@forinda/kickjs': '^5.0.0', express: '^5.1.0' },
      }),
    })
    expect(checkExpressInstalled(ctx(dir))?.status).toBe('pass')
  })

  it('skips (returns null) when there is no kickjs and no express', () => {
    const dir = tempProject({ 'package.json': JSON.stringify({ dependencies: {} }) })
    expect(checkExpressInstalled(ctx(dir))).toBeNull()
  })
})

// ── checkDecoratorTsConfig ────────────────────────────────────────────

describe('checkDecoratorTsConfig', () => {
  it('passes when both decorator flags are enabled', () => {
    const c = ctx('/x', {
      tsconfig: {
        compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
      },
    })
    const rs = checkDecoratorTsConfig(c)
    expect(rs.every((r) => r.status === 'pass')).toBe(true)
  })

  it('fails when experimentalDecorators is missing', () => {
    const c = ctx('/x', {
      tsconfig: { compilerOptions: { emitDecoratorMetadata: true } },
    })
    const rs = checkDecoratorTsConfig(c)
    const exp = rs.find((r) => r.name.includes('experimentalDecorators'))
    expect(exp?.status).toBe('fail')
  })

  it('fails when tsconfig.json is missing entirely', () => {
    const rs = checkDecoratorTsConfig(ctx('/x', { tsconfig: null }))
    expect(rs[0]?.status).toBe('fail')
    expect(rs[0]?.fix).toContain('tsconfig.json')
  })
})

// ── checkEnvWiring (the canonical footgun check) ──────────────────────

describe('checkEnvWiring', () => {
  it('skips when no env-init file exists', () => {
    const dir = tempProject({ 'src/index.ts': 'export {}\n' })
    expect(checkEnvWiring(ctx(dir))).toBeNull()
  })

  it("skips when an env file exists but doesn't call loadEnv()", () => {
    // Just having `src/env.ts` isn't proof of env wiring — it has to
    // actually call loadEnv() for the check to apply.
    const dir = tempProject({
      'src/env.ts': 'export const foo = 1',
      'src/index.ts': 'export {}',
    })
    expect(checkEnvWiring(ctx(dir))).toBeNull()
  })

  it("fails when src/env.ts has loadEnv but src/index.ts doesn't import it", () => {
    const dir = tempProject({
      'src/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': "import 'reflect-metadata'\nimport { bootstrap } from '@forinda/kickjs'\n",
    })
    const r = checkEnvWiring(ctx(dir))
    expect(r?.status).toBe('fail')
    expect(r?.fix).toContain("import './env'")
  })

  it('passes when src/env.ts is imported before bootstrap()', () => {
    const dir = tempProject({
      'src/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': `import 'reflect-metadata'
import './env'
import { bootstrap } from '@forinda/kickjs'
bootstrap({})
`,
    })
    expect(checkEnvWiring(ctx(dir))?.status).toBe('pass')
  })

  it('warns when env import lands AFTER bootstrap()', () => {
    const dir = tempProject({
      'src/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': `import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
bootstrap({})
import './env'
`,
    })
    const r = checkEnvWiring(ctx(dir))
    expect(r?.status).toBe('warn')
    expect(r?.message).toContain('AFTER bootstrap')
  })

  it('handles src/config/env.ts variation', () => {
    const dir = tempProject({
      'src/config/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': `import 'reflect-metadata'
import './config/env'
import { bootstrap } from '@forinda/kickjs'
bootstrap({})
`,
    })
    expect(checkEnvWiring(ctx(dir))?.status).toBe('pass')
  })

  it('handles src/config/index.ts variation', () => {
    const dir = tempProject({
      'src/config/index.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': `import 'reflect-metadata'
import './config'
import { bootstrap } from '@forinda/kickjs'
bootstrap({})
`,
    })
    expect(checkEnvWiring(ctx(dir))?.status).toBe('pass')
  })

  it('handles the @/ alias import form', () => {
    const dir = tempProject({
      'src/config/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': `import 'reflect-metadata'
import '@/config/env'
import { bootstrap } from '@forinda/kickjs'
bootstrap({})
`,
    })
    expect(checkEnvWiring(ctx(dir))?.status).toBe('pass')
  })

  it("fails when src/config/env.ts has loadEnv but src/index.ts doesn't import it", () => {
    const dir = tempProject({
      'src/config/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': "import { bootstrap } from '@forinda/kickjs'\n",
    })
    const r = checkEnvWiring(ctx(dir))
    expect(r?.status).toBe('fail')
    expect(r?.message).toContain('config/env.ts')
  })

  it('falls back to src/main.ts when src/index.ts is absent', () => {
    const dir = tempProject({
      'src/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/main.ts': `import './env'\nimport { bootstrap } from '@forinda/kickjs'\nbootstrap({})\n`,
    })
    expect(checkEnvWiring(ctx(dir))?.status).toBe('pass')
  })
})

// ── runChecks integration + extensibility ─────────────────────────────

describe('runChecks', () => {
  it('aggregates pass + fail + skipped checks into a single results array', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        dependencies: {
          '@forinda/kickjs': '^5.0.0',
          'reflect-metadata': '^0.2.0',
          express: '^5.0.0',
        },
      }),
      // no tsconfig → both decorator checks fail; no env.ts → env-wiring skipped
    })
    const results = await runChecks(dir)
    expect(results.length).toBeGreaterThan(0)
    expect(results.find((r) => r.name === 'Node version')).toBeDefined()
    const kickjsCheck = results.find((r) => r.name === '@forinda/kickjs installed')
    expect(kickjsCheck?.status).toBe('pass')
    expect(results.find((r) => r.name === 'tsconfig.json present')?.status).toBe('fail')
  })

  it('runs caller-supplied extra checks after the built-ins', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        dependencies: { '@forinda/kickjs': '^5.0.0' },
      }),
    })
    const results = await runChecks(dir, {
      extraChecks: [() => ({ name: 'My custom check', status: 'pass' })],
    })
    expect(results.find((r) => r.name === 'My custom check')?.status).toBe('pass')
  })

  it('skips extra checks that return null — no null entries pollute the result array', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ dependencies: {} }),
    })
    // Bracket the built-in checks with two null-returning extras AND a
    // real one. The real one MUST appear; the nulls MUST be skipped (no
    // null/undefined entries, no extra slots in the array).
    const results = await runChecks(dir, {
      extraChecks: [() => null, () => ({ name: 'Real check', status: 'pass' }), () => null],
    })
    expect(results.every((r) => r != null)).toBe(true)
    expect(results.some((r) => r.name === 'Real check')).toBe(true)
    // Exactly one entry per non-null check — the two nulls add nothing.
    const realIdx = results.findIndex((r) => r.name === 'Real check')
    expect(realIdx).toBeGreaterThanOrEqual(0)
    expect(results.filter((r) => r.name === 'Real check').length).toBe(1)
  })

  it('isolates failing checks so one extension cannot abort the whole report', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ dependencies: {} }),
    })
    const results = await runChecks(dir, {
      extraChecks: [
        () => {
          throw new Error('Boom from a buggy extension')
        },
        () => ({ name: 'After the boom', status: 'pass' }),
      ],
    })
    // Built-ins still ran
    expect(results.find((r) => r.name === 'Node version')).toBeDefined()
    // The throwing check produced a synthetic fail with the error message
    const synthetic = results.find((r) => r.status === 'fail' && r.message?.includes('Boom'))
    expect(synthetic).toBeDefined()
    // The check AFTER the thrower still ran — the loop didn't abort
    expect(results.find((r) => r.name === 'After the boom')?.status).toBe('pass')
  })

  it('awaits async extra checks', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ dependencies: {} }),
    })
    const results = await runChecks(dir, {
      extraChecks: [
        async () => {
          await new Promise((r) => setTimeout(r, 1))
          return { name: 'Async check', status: 'pass' }
        },
      ],
    })
    expect(results.find((r) => r.name === 'Async check')?.status).toBe('pass')
  })
})

// ── defineDoctorExtension / defineDoctorCheck identity helpers ────────

describe('defineDoctorExtension', () => {
  it('returns the same object it received (identity for inference)', () => {
    const input = {
      checks: [() => ({ name: 'X', status: 'pass' as const })],
    }
    expect(defineDoctorExtension(input)).toBe(input)
  })

  it('extensions plug into runChecks unchanged', async () => {
    const dir = tempProject({ 'package.json': JSON.stringify({ dependencies: {} }) })
    const ext = defineDoctorExtension({
      checks: [() => ({ name: 'Custom from extension', status: 'pass' })],
    })
    const results = await runChecks(dir, { extraChecks: ext.checks })
    expect(results.find((r) => r.name === 'Custom from extension')?.status).toBe('pass')
  })
})

describe('defineDoctorCheck', () => {
  it('returns the same function it received', () => {
    const fn = () => ({ name: 'X', status: 'pass' as const })
    expect(defineDoctorCheck(fn)).toBe(fn)
  })

  it('a check authored with defineDoctorCheck plugs into runChecks', async () => {
    const dir = tempProject({ 'package.json': JSON.stringify({ dependencies: {} }) })
    const myCheck = defineDoctorCheck((ctx) => ({
      name: 'Bound check',
      status: ctx.pkg ? 'pass' : 'fail',
    }))
    const results = await runChecks(dir, { extraChecks: [myCheck] })
    expect(results.find((r) => r.name === 'Bound check')?.status).toBe('pass')
  })
})
