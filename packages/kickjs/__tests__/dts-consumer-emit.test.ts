/**
 * Reproduces TS4023 the only way it can actually happen: by emitting a
 * declaration for an EXPORTED symbol in a consumer that resolves this package
 * by NAME, against the built `.d.mts`.
 *
 * The sibling `context-decorator-public-types.test.ts` guards that the types
 * stay exported, which is the root cause — but it cannot reproduce the error
 * itself. Two reasons: it declares `Tenant` locally rather than exporting it,
 * and `tsconfig.typetests.json` is `noEmit`. More fundamentally, everything it
 * imports comes from `../src`, and a type in the same program is ALWAYS
 * nameable — TypeScript just writes `import("../src/core/context-decorator")`.
 * That is precisely why the original bug shipped green: the framework's own
 * build could never see it.
 *
 * Downstream the shape is different. `dist/index.d.mts` re-exports from hashed
 * chunk files, and a consumer emitting a declaration for
 *
 *   export const Tenant = defineContextDecorator({ ... })
 *
 * has no import path to a type the entry does not re-export:
 *
 *   TS4023: Exported variable 'Tenant' has or is using name
 *   'ContextDecoratorWithDefaults' from external module … but cannot be named
 *
 * Every file `kick g contributor` writes is exactly that shape, so all of them
 * failed `tsc --noEmit` in a scaffolded app.
 *
 * Needs `dist/` — it asserts on the built artifact deliberately, since the
 * built artifact is what consumers see.
 */

import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(__dirname, '..')
const DTS_ENTRY = join(PKG_ROOT, 'dist', 'index.d.mts')

/** Mirrors what `kick g contributor` emits, including the `export`. */
const CONSUMER = `
import { defineContextDecorator } from '@forinda/kickjs'

export const Tenant = defineContextDecorator({
  key: 'tenant',
  resolve: () => ({ id: 'org_1' }),
})

export const Project = defineContextDecorator.withParams<{ orgId: string }>()({
  key: 'project',
  paramDefaults: { orgId: 'default' },
  resolve: (_ctx, _deps, params) => ({ id: params.orgId }),
})

// No \`paramDefaults\` for a required field, so this one infers the OTHER
// branch of the union — \`ContextDecoratorRequiringParams\`. Without it both
// consts above land on \`ContextDecoratorWithDefaults\` and a regression that
// un-exported only the requires-params shape would sail through.
export const Audit = defineContextDecorator.withParams<{ actorId: string }>()({
  key: 'audit',
  resolve: (_ctx, _deps, params) => ({ actor: params.actorId }),
})
`

// The documented \`src/middleware/index.ts\` layout: export the array and let
// its type be inferred. \`requestLogger()\` typed its handler with private
// \`LoggedRequest\`/\`LoggedResponse\` interfaces, so this could not be named
// downstream — the recommended project layout walked straight into TS4023.
const MIDDLEWARE_CONSUMER = `
import { cors, helmet, requestId, requestLogger } from '@forinda/kickjs'

export const middleware = [helmet(), cors({ origin: '*' }), requestId(), requestLogger()]
`

describe('a consumer can emit declarations for an exported contributor', () => {
  it('produces no TS4023 against the built package types', () => {
    expect(existsSync(DTS_ENTRY), 'dist/index.d.mts missing — run pnpm build first').toBe(true)

    const dir = mkdtempSync(join(tmpdir(), 'kick-dts-'))
    try {
      writeFileSync(join(dir, 'consumer.ts'), CONSUMER)
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              // `declaration` + `emitDeclarationOnly` is the whole point:
              // TS4023 is a declaration-EMIT diagnostic and never fires
              // under a plain `noEmit` typecheck.
              declaration: true,
              emitDeclarationOnly: true,
              outDir: 'out',
              strict: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              target: 'es2022',
              skipLibCheck: true,
              experimentalDecorators: true,
              // Resolve by NAME, the way a real dependant does, so the
              // entry's re-exports are the only path to a type.
              paths: { '@forinda/kickjs': [DTS_ENTRY] },
            },
            files: ['consumer.ts'],
          },
          null,
          2,
        ),
      )

      const tsc = resolve(PKG_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
      const result = spawnSync(process.execPath, [tsc, '-p', dir], {
        encoding: 'utf8',
        timeout: 120_000,
      })
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

      // Prove the compiler actually ran and emitted before asserting on the
      // ABSENCE of a diagnostic. Without this the test passes when tsc fails
      // to launch or the import silently resolves to nothing — empty output
      // satisfies every `not.toContain` below. An earlier revision of this
      // file did exactly that: a stripped `.d.mts` extension made the path
      // mapping resolve to nothing, and it stayed green with the export it
      // guards deleted.
      const emitted = join(dir, 'out', 'consumer.d.ts')
      expect(existsSync(emitted), `tsc emitted nothing. Output:\n${output}`).toBe(true)
      const declaration = readFileSync(emitted, 'utf8')
      expect(declaration).toContain('Tenant')
      // Both union branches must be present, or this guard only covers one.
      expect(declaration).toContain('ContextDecoratorWithDefaults')
      expect(declaration).toContain('ContextDecoratorRequiringParams')

      // Assert on TS4023 specifically rather than a clean exit: unrelated
      // config noise in a throwaway project should not fail this, but a
      // type that stopped being nameable must.
      expect(output).not.toContain('TS4023')
      expect(output).not.toContain('cannot be named')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('a consumer can emit declarations for an exported middleware array', () => {
  // The documented "keep src/index.ts thin" layout: build the array in
  // src/middleware/index.ts and export it with an inferred type. requestLogger()
  // typed its handler with private LoggedRequest / LoggedResponse interfaces,
  // so downstream that type had no importable name and the recommended layout
  // failed to compile. Two teams hit it independently.
  it('produces no TS4023 for the documented middleware/index.ts pattern', () => {
    expect(existsSync(DTS_ENTRY), 'dist/index.d.mts missing — run pnpm build first').toBe(true)

    // Inside the package, not tmpdir: a real dependant resolves `@types/express`
    // through its own node_modules, and only then are Express's own symbols
    // nameable. From /tmp the array trips TS2883 ("not portable") on
    // `ParamsDictionary` long before it reaches the symbols this test is about.
    const dir = mkdtempSync(join(PKG_ROOT, '.dts-mw-'))
    try {
      writeFileSync(join(dir, 'consumer.ts'), MIDDLEWARE_CONSUMER)
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              declaration: true,
              emitDeclarationOnly: true,
              outDir: 'out',
              strict: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              target: 'es2022',
              skipLibCheck: true,
              experimentalDecorators: true,
              paths: { '@forinda/kickjs': [DTS_ENTRY] },
            },
            files: ['consumer.ts'],
          },
          null,
          2,
        ),
      )

      const tsc = resolve(PKG_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
      const result = spawnSync(process.execPath, [tsc, '-p', dir], {
        encoding: 'utf8',
        timeout: 120_000,
      })
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

      // Same reasoning as the sibling test: prove it emitted before asserting
      // on the absence of a diagnostic, or empty output passes trivially.
      const emitted = join(dir, 'out', 'consumer.d.ts')
      expect(existsSync(emitted), `tsc emitted nothing. Output:\n${output}`).toBe(true)
      expect(readFileSync(emitted, 'utf8')).toContain('middleware')

      expect(output).not.toContain('TS4023')
      expect(output).not.toContain('cannot be named')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
