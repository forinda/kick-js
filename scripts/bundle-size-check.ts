/**
 * Bundle-size assertion harness for the Babel devtools-strip plugin
 * (`@forinda/kickjs-vite > devtoolsStripPlugin`). M4.D from
 * `docs/db/m4-plan.md`.
 *
 * Validates that the strip transform actually removes
 * `@forinda/kickjs-devtools-kit` imports + their top-level call sites
 * from production bundles. The assertion is the only thing standing
 * between a future regression and silently shipping ~3-9 KB of
 * dev-only code into adopters' production builds.
 *
 * How it works:
 *
 *   1. Writes a small TS fixture under
 *      `.kickjs/bundle-size/<mode>/src/index.ts` — outside
 *      `node_modules/` because the strip plugin short-circuits on any
 *      id containing `node_modules`. The fixture imports several
 *      `@forinda/kickjs-devtools-kit` APIs at the top level (the only
 *      pattern the strip plugin acts on).
 *   2. Runs `vite build` programmatically twice — once with
 *      `kickjsVitePlugin()` defaults (devtools strip ON), once with
 *      `kickjsVitePlugin({ devtools: false })` (strip OFF).
 *   3. Sums the byte size of every `.mjs` file in each output dir.
 *   4. Reports the delta + asserts it clears `MIN_DELTA_BYTES`. The
 *      default floor is intentionally conservative (1 KB) — high
 *      enough to fail when the strip is a no-op, low enough not to
 *      flake on bundler-version size drift.
 *
 * Usage:
 *
 *   pnpm test:bundle-size                     # default floor (1024)
 *   KICKJS_BUNDLE_DELTA_FLOOR=4096 pnpm test:bundle-size
 *
 * Exit codes: 0 on success, 1 on assertion failure or build error.
 */

import { mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
// Outside node_modules — the devtools strip plugin short-circuits on
// any id containing `node_modules`, so a fixture there gets ignored
// silently. `.kickjs/` is already adopter-side convention for
// CLI-managed scratch and lives under the project root.
const cacheRoot = resolve(repoRoot, '.kickjs/bundle-size')

// Conservative floor — see header comment. A no-op strip produces
// delta ~0 (vite tree-shakes unused imports either way only when the
// imports are unused; the strip's value is removing the imports
// before the bundler runs and refusing to drop the top-level
// expression because of the side-effect rule).
const MIN_DELTA_BYTES = parseDeltaFloor(process.env.KICKJS_BUNDLE_DELTA_FLOOR)

/**
 * Parse the `KICKJS_BUNDLE_DELTA_FLOOR` env var. Refuses anything that
 * isn't a non-negative finite integer — silent NaN coercion (the
 * default `Number(...)` shape) would make the threshold check pass
 * unconditionally and silently bypass the regression gate.
 */
function parseDeltaFloor(raw: string | undefined): number {
  if (raw == null || raw === '') return 1024
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0 || String(n) !== raw.trim()) {
    console.error(
      `[bundle-size] invalid KICKJS_BUNDLE_DELTA_FLOOR='${raw}'. ` +
        `Expected a non-negative integer (bytes).`,
    )
    process.exit(1)
  }
  return n
}

const FIXTURE_SOURCE = `// Bundle-size fixture for M4.D — exercises the devtools-strip rules
// exactly as the babel-strip-devtools header documents them.
//
// The strip removes:
//   1. import declarations from '@forinda/kickjs-devtools-kit'
//   2. top-level ExpressionStatements whose root identifier was
//      imported from devtools-kit (the \`defineDevtoolsRenderTab(...)\`
//      side-effect pattern).
//
// References inside other expressions are intentionally NOT removed
// (the strip plugin says: "After we drop the import the build will
// fail loud — that is the signal to gate the call behind
// __KICKJS_DEVTOOLS__"). So this fixture sticks to top-level call
// statements only — that's the supported pattern, and that's what
// the bundle-size delta is supposed to measure.
//
// We deliberately call several distinct devtools-kit factories so
// the bundler is forced to pull in their bodies pre-strip — the
// post-strip output should drop the entire devtools-kit chunk.

import {
  defineDevtoolsRenderTab,
  defineDevtoolsTab,
  createInMemoryBus,
  createBrowserBus,
  heapGrowthBytesPerSec,
} from '@forinda/kickjs-devtools-kit'

defineDevtoolsRenderTab({
  id: 'bundle-size-fixture-a',
  title: 'Fixture A',
  render: () => null,
})

defineDevtoolsRenderTab({
  id: 'bundle-size-fixture-b',
  title: 'Fixture B',
  render: () => null,
})

defineDevtoolsTab({
  id: 'bundle-size-fixture-c',
  title: 'Fixture C',
  view: { kind: 'static', html: '<div />' },
})

createInMemoryBus()
createBrowserBus()
heapGrowthBytesPerSec([
  { ts: 0, heapUsed: 100 },
  { ts: 1000, heapUsed: 200 },
])

// Side-effect entry — keeps the bundle non-empty so we can measure
// without tripping vite's empty-input warning.
console.log('[bundle-size-fixture] booted')
`

interface BuildMode {
  name: 'with-strip' | 'no-strip'
  devtools: false | undefined
}

async function main(): Promise<void> {
  const start = Date.now()
  console.log('[bundle-size] preparing fixtures…')

  await rm(cacheRoot, { recursive: true, force: true })
  await mkdir(cacheRoot, { recursive: true })

  const modes: BuildMode[] = [
    { name: 'with-strip', devtools: undefined },
    { name: 'no-strip', devtools: false },
  ]

  const sizes = new Map<string, number>()
  for (const mode of modes) {
    const dir = resolve(cacheRoot, mode.name)
    await prepareFixture(dir)
    console.log(
      `[bundle-size] building '${mode.name}' (devtools strip ${mode.devtools === false ? 'OFF' : 'ON'})…`,
    )
    await runBuild(dir, mode)
    const distDir = resolve(dir, 'dist')
    const total = await sumOutputBytes(distDir)
    sizes.set(mode.name, total)
    console.log(`[bundle-size]   ${mode.name}: ${formatBytes(total)} (${total} bytes)`)
  }

  const noStrip = sizes.get('no-strip') ?? 0
  const withStrip = sizes.get('with-strip') ?? 0
  const delta = noStrip - withStrip
  const pct = noStrip > 0 ? ((delta / noStrip) * 100).toFixed(1) : '0.0'

  console.log('')
  console.log('[bundle-size] result:')
  console.log(`  no-strip   : ${formatBytes(noStrip)}`)
  console.log(`  with-strip : ${formatBytes(withStrip)}`)
  console.log(`  delta      : ${formatBytes(delta)} (${pct}%)`)
  console.log(`  threshold  : ${formatBytes(MIN_DELTA_BYTES)}`)
  console.log(`  elapsed    : ${((Date.now() - start) / 1000).toFixed(1)}s`)
  console.log('')

  if (delta < MIN_DELTA_BYTES) {
    console.error(
      `[bundle-size] ✗ FAIL — delta ${delta} bytes is below floor ${MIN_DELTA_BYTES}. ` +
        `The devtools strip plugin may have regressed: top-level devtools-kit imports ` +
        `should drop ~1KB+ from the production bundle. Inspect ` +
        `${resolve(cacheRoot, 'no-strip/dist')} vs ${resolve(cacheRoot, 'with-strip/dist')}.`,
    )
    process.exit(1)
  }

  console.log('[bundle-size] ✓ PASS')
}

async function prepareFixture(dir: string): Promise<void> {
  const srcDir = resolve(dir, 'src')
  await mkdir(srcDir, { recursive: true })
  await writeFile(resolve(srcDir, 'index.ts'), FIXTURE_SOURCE, 'utf8')

  // package.json with the bare minimum so vite resolves
  // @forinda/kickjs-devtools-kit through the workspace.
  await writeFile(
    resolve(dir, 'package.json'),
    JSON.stringify(
      {
        name: `kickjs-bundle-size-${dir.endsWith('with-strip') ? 'with' : 'no'}-strip`,
        private: true,
        type: 'module',
        version: '0.0.0',
      },
      null,
      2,
    ),
    'utf8',
  )
}

async function runBuild(dir: string, mode: BuildMode): Promise<void> {
  // Programmatic vite import — done lazily so `tsx scripts/...` doesn't
  // pay vite's load cost when the script aborts early.
  const { build } = await import('vite')
  const { kickjsVitePlugin } = await import('@forinda/kickjs-vite')
  const swc = await import('unplugin-swc')

  await build({
    root: dir,
    configFile: false,
    logLevel: 'warn',
    oxc: false,
    plugins: [
      swc.default.vite(),
      kickjsVitePlugin({
        entry: 'src/index.ts',
        // Pass `devtools: false` to skip the strip plugin entirely;
        // otherwise the default wires it in.
        ...(mode.devtools === false ? { devtools: false } : {}),
      }),
    ],
    resolve: {
      alias: {
        // Redirect @forinda/kickjs-devtools-kit to the workspace dist —
        // the temp fixture has no node_modules of its own, so without
        // this vite would fail resolution.
        '@forinda/kickjs-devtools-kit': resolve(repoRoot, 'packages/devtools-kit/dist/index.mjs'),
      },
    },
    build: {
      target: 'node20',
      ssr: true,
      outDir: resolve(dir, 'dist'),
      sourcemap: false,
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(dir, 'src/index.ts'),
        output: { format: 'esm' },
      },
    },
  })
}

async function sumOutputBytes(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  const entries = await readdir(dir)
  let total = 0
  for (const name of entries) {
    if (!name.endsWith('.mjs') && !name.endsWith('.js')) continue
    const abs = join(dir, name)
    const s = await stat(abs)
    if (s.isFile()) total += s.size
  }
  return total
}

function formatBytes(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${n} bytes`
}

main().catch((err) => {
  console.error('[bundle-size] error:', err)
  process.exit(1)
})
