import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
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

function tempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-doctor-'))
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows sometimes holds the lock briefly; tolerate.
  }
}

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
    cleanup(dir)
  })

  it('fails when @forinda/kickjs is missing', () => {
    const dir = tempProject({ 'package.json': JSON.stringify({ name: 'x', dependencies: {} }) })
    const r = checkKickJsInstalled(ctx(dir))
    expect(r.status).toBe('fail')
    expect(r.fix).toContain('kick new')
    cleanup(dir)
  })

  it('warns when package.json is missing', () => {
    const dir = tempProject({})
    const r = checkKickJsInstalled(ctx(dir))
    expect(r.status).toBe('warn')
    cleanup(dir)
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
    cleanup(dir)
  })

  it('fails when reflect-metadata is missing', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }),
    })
    const r = checkReflectMetadata(ctx(dir))
    expect(r.status).toBe('fail')
    expect(r.fix).toContain('reflect-metadata')
    cleanup(dir)
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
    cleanup(dir)
  })

  it('passes when both kickjs and express are installed', () => {
    const dir = tempProject({
      'package.json': JSON.stringify({
        dependencies: { '@forinda/kickjs': '^5.0.0', express: '^5.1.0' },
      }),
    })
    expect(checkExpressInstalled(ctx(dir))?.status).toBe('pass')
    cleanup(dir)
  })

  it('skips (returns null) when there is no kickjs and no express', () => {
    const dir = tempProject({ 'package.json': JSON.stringify({ dependencies: {} }) })
    expect(checkExpressInstalled(ctx(dir))).toBeNull()
    cleanup(dir)
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
    cleanup(dir)
  })

  it("skips when an env file exists but doesn't call loadEnv()", () => {
    // Just having `src/env.ts` isn't proof of env wiring — it has to
    // actually call loadEnv() for the check to apply.
    const dir = tempProject({
      'src/env.ts': 'export const foo = 1',
      'src/index.ts': 'export {}',
    })
    expect(checkEnvWiring(ctx(dir))).toBeNull()
    cleanup(dir)
  })

  it("fails when src/env.ts has loadEnv but src/index.ts doesn't import it", () => {
    const dir = tempProject({
      'src/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': "import 'reflect-metadata'\nimport { bootstrap } from '@forinda/kickjs'\n",
    })
    const r = checkEnvWiring(ctx(dir))
    expect(r?.status).toBe('fail')
    expect(r?.fix).toContain("import './env'")
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
  })

  it("fails when src/config/env.ts has loadEnv but src/index.ts doesn't import it", () => {
    const dir = tempProject({
      'src/config/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/index.ts': "import { bootstrap } from '@forinda/kickjs'\n",
    })
    const r = checkEnvWiring(ctx(dir))
    expect(r?.status).toBe('fail')
    expect(r?.message).toContain('config/env.ts')
    cleanup(dir)
  })

  it('falls back to src/main.ts when src/index.ts is absent', () => {
    const dir = tempProject({
      'src/env.ts': 'import { loadEnv } from "@forinda/kickjs"\nloadEnv({})',
      'src/main.ts': `import './env'\nimport { bootstrap } from '@forinda/kickjs'\nbootstrap({})\n`,
    })
    expect(checkEnvWiring(ctx(dir))?.status).toBe('pass')
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
  })

  it('skips extra checks that return null', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ dependencies: {} }),
    })
    const results = await runChecks(dir, {
      extraChecks: [() => null],
    })
    expect(results.find((r) => r.name === 'My custom check')).toBeUndefined()
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
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
    cleanup(dir)
  })
})
