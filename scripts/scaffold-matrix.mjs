#!/usr/bin/env node
/**
 * Scaffold-and-boot matrix: `kick new` a project per scenario, install it
 * against THIS checkout's packages, and check it builds and serves.
 *
 *   node scripts/scaffold-matrix.mjs                 # every scenario
 *   node scripts/scaffold-matrix.mjs yes-default     # just one (or several)
 *   node scripts/scaffold-matrix.mjs --list [--json]
 *
 * Run `pnpm build` first. Every published `@forinda/*` package is packed
 * (`pnpm pack` — what npm would get) and pinned with pnpm `overrides`, so a
 * scaffold is tested against the code in this commit, installed the way a
 * user installs it. Not `link:`: Vite bundles a linked package into the
 * build instead of leaving it external, which is not what users run.
 * Third-party packages come from the registry.
 *
 * Per scenario: kick new → (kick add) → pnpm install → kick typegen →
 * tsc --noEmit → (web build) → kick build (or the app's build script) → kick start → HTTP checks.
 * With `deploy`, also build:netlify / build:vercel and serve the Vercel
 * function from a copy outside the project; with `docker`, build the
 * scaffold's Dockerfile and request the same paths from the container.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'packages/cli/bin.js')

/** `app` is created with `kick new app --yes --pm pnpm --no-install --no-git ...args`. */
const SCENARIOS = {
  'yes-default': { args: [], get: ['/api/v1/hello'] },
  'rest-express-all-packages': {
    args: ['--template', 'rest', '--schema', 'valibot', '--packages', 'swagger,devtools,ws,queue'],
    get: ['/api/v1/hello', '/openapi.json'],
  },
  'minimal-fastify-yup-swagger': {
    args: ['--runtime', 'fastify', '--schema', 'yup', '--packages', 'swagger'],
    get: ['/api/v1/hello', '/openapi.json'],
  },
  'rest-h3-devtools': {
    args: ['--template', 'rest', '--runtime', 'h3', '--packages', 'devtools'],
    get: ['/api/v1/hello'],
  },
  'rest-deploy': {
    args: ['--template', 'rest'],
    get: ['/api/v1/hello'],
    deploy: true,
    docker: true,
  },
  'kick-add-wiring': {
    args: ['--runtime', 'fastify'],
    add: ['swagger', 'ws', 'queue'],
    get: ['/api/v1/hello', '/openapi.json'],
  },
  inertia: {
    args: ['--template', 'inertia'],
    buildScript: true,
    get: ['/api/v1/hello', '/', '/posts'],
    // Rendered on the server, not the client-side fallback.
    contains: { '/': 'data-server-rendered' },
    deploy: true,
    docker: true,
  },
  fullstack: {
    args: ['--template', 'fullstack', '--packages', 'swagger'],
    fullstack: true,
    get: ['/api/v1/hello', '/openapi.json'],
    deploy: true,
    docker: true,
  },
}

/** Pack every published `@forinda/*` workspace package into `dest`: name → tarball. */
function packWorkspace(dest) {
  const out = {}
  for (const dir of readdirSync(join(ROOT, 'packages'))) {
    const file = join(ROOT, 'packages', dir, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf-8'))
    if (!pkg.name?.startsWith('@forinda/') || pkg.private) continue
    const result = spawnSync('pnpm', ['pack', '--pack-destination', dest], {
      cwd: join(ROOT, 'packages', dir),
      encoding: 'utf-8',
    })
    if (result.status !== 0) throw new Error(`pnpm pack failed for ${pkg.name}:\n${result.stderr}`)
    const tarball = result.stdout.trim().split('\n').at(-1)
    out[pkg.name] = resolve(dest, tarball.split('/').at(-1))
  }
  return out
}

function run(label, cmd, args, cwd, env = {}) {
  process.stdout.write(`  · ${label} … `)
  const started = Date.now()
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    maxBuffer: 64 * 1024 * 1024,
  })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  if (result.status !== 0) {
    console.log(`FAILED (${secs}s)`)
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n')
    console.log(
      output
        .slice(-40)
        .map((line) => `      ${line}`)
        .join('\n'),
    )
    throw new Error(`${label} failed`)
  }
  console.log(`ok (${secs}s)`)
  return result.stdout
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

/** Start `kick start`, request each path until it answers 200, then stop it. */
async function boot(cwd, paths) {
  const port = await freePort()
  process.stdout.write(`  · kick start + GET ${paths.join(', ')} … `)
  const child = spawn('pnpm', ['exec', 'kick', 'start'], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', PORT: String(port), NODE_ENV: 'production' },
    detached: true,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  try {
    for (const path of paths) {
      const deadline = Date.now() + 30_000
      let status = 0
      while (Date.now() < deadline) {
        // Bounded by the deadline too: a server that accepts the connection
        // but never answers would otherwise hang here past it.
        status = await fetch(`http://127.0.0.1:${port}${path}`, {
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        })
          .then((res) => res.status)
          .catch(() => 0)
        if (status === 200 || child.exitCode !== null) break
        await new Promise((r) => setTimeout(r, 500))
      }
      if (status !== 200) {
        console.log(`FAILED — GET ${path} → ${status || 'no answer'}`)
        console.log(
          log
            .trim()
            .split('\n')
            .slice(-30)
            .map((l) => `      ${l}`)
            .join('\n'),
        )
        throw new Error(`GET ${path} failed`)
      }
    }
    console.log('ok')
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

/** Where the tarballs go inside a project whose image is built. */
const PACKS = '.kick-packs'

/**
 * GET each path on `base` until it answers 200 or the deadline passes; a path
 * in `contains` must also include that text.
 */
async function expectOk(base, paths, logs, contains = {}) {
  for (const path of paths) {
    const deadline = Date.now() + 60_000
    let status = 0
    while (Date.now() < deadline) {
      status = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      })
        .then((res) => res.status)
        .catch(() => 0)
      if (status === 200) break
      await new Promise((r) => setTimeout(r, 500))
    }
    if (status !== 200) {
      console.log(`FAILED — GET ${path} → ${status || 'no answer'}`)
      if (logs) console.log(logs())
      throw new Error(`GET ${path} failed`)
    }
    if (contains[path]) {
      const body = await fetch(`${base}${path}`).then((res) => res.text())
      if (!body.includes(contains[path])) {
        console.log(`FAILED — GET ${path} has no "${contains[path]}"`)
        if (logs) console.log(logs())
        throw new Error(`GET ${path} content`)
      }
    }
  }
}

/**
 * `build:netlify` and `build:vercel`, then the Vercel function served from a
 * copy outside the project — so it can only use what it was packaged with.
 */
async function deployBuilds(root, paths, contains) {
  run('build:netlify', 'pnpm', ['run', 'build:netlify'], root)
  run('build:vercel', 'pnpm', ['run', 'build:vercel'], root)
  const fn = mkdtempSync(join(tmpdir(), 'kick-matrix-func-'))
  cpSync(join(root, '.vercel/output/functions/api.func'), fn, { recursive: true })
  const port = await freePort()
  process.stdout.write(`  · Vercel function, outside the project + GET ${paths.join(', ')} … `)
  const harness = `import http from 'node:http'
const { default: handle } = await import(${JSON.stringify(pathToFileURL(join(fn, 'index.mjs')).href)})
http.createServer((req, res) => handle(req, res)).listen(${port}, '127.0.0.1')`
  const child = spawn('node', ['--input-type=module', '-e', harness], {
    cwd: tmpdir(),
    env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: 'matrix-secret-matrix-secret' },
    detached: true,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  try {
    await expectOk(
      `http://127.0.0.1:${port}`,
      paths,
      () => log.trim().split('\n').slice(-30).join('\n'),
      contains,
    )
    console.log('ok')
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    rmSync(fn, { recursive: true, force: true })
  }
}

/** Build the scaffold's Dockerfile and request each path from the container. */
async function dockerImage(name, root, paths, contains) {
  // The image installs from the lockfile, which points at the tarballs in the
  // context; nothing else in the Dockerfile changes.
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf-8')
  writeFileSync(
    join(root, 'Dockerfile'),
    dockerfile.replace(/^(FROM .* AS base\nWORKDIR \/app)$/m, `$1\nCOPY ${PACKS} ./${PACKS}`),
  )
  const tag = `kick-matrix-${name}:latest`
  run('docker build', 'docker', ['build', '-q', '-t', tag, '.'], root)
  const port = await freePort()
  const id = run(
    'docker run',
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '-p',
      `127.0.0.1:${port}:3000`,
      '-e',
      'SESSION_SECRET=matrix-secret-matrix-secret',
      tag,
    ],
    root,
  ).trim()
  process.stdout.write(`  · GET ${paths.join(', ')} from the container … `)
  try {
    await expectOk(
      `http://127.0.0.1:${port}`,
      paths,
      () =>
        spawnSync('docker', ['logs', id], { encoding: 'utf-8' })
          .stdout.split('\n')
          .slice(-30)
          .join('\n'),
      contains,
    )
    console.log('ok')
  } finally {
    spawnSync('docker', ['rm', '-f', id])
    spawnSync('docker', ['rmi', '-f', tag])
  }
}

async function runScenario(name, scenario, tarballs) {
  console.log(`\n▶ ${name}`)
  const work = mkdtempSync(join(tmpdir(), `kick-matrix-${name}-`))
  try {
    run(
      'kick new',
      'node',
      [CLI, 'new', 'app', '--yes', '--pm', 'pnpm', '--no-install', '--no-git', ...scenario.args],
      work,
    )
    const root = join(work, 'app')
    const server = scenario.fullstack ? join(root, 'server') : root

    // Every @forinda/* package, direct or transitive, is this checkout's.
    const yaml = join(root, 'pnpm-workspace.yaml')
    const current = existsSync(yaml) ? readFileSync(yaml, 'utf-8') : ''
    // For an image build the tarballs travel in the build context, so the
    // lockfile has to point at them by a path inside the project.
    if (scenario.docker)
      cpSync(dirname(Object.values(tarballs)[0]), join(root, PACKS), { recursive: true })
    const overrides = Object.entries(tarballs)
      .map(([pkg, tarball]) =>
        scenario.docker
          ? `  '${pkg}': 'file:./${PACKS}/${basename(tarball)}'`
          : `  '${pkg}': 'file:${tarball}'`,
      )
      .join('\n')
    writeFileSync(yaml, `${current.trimEnd()}\n\noverrides:\n${overrides}\n`)

    run('pnpm install', 'pnpm', ['install', '--no-frozen-lockfile'], root)
    if (scenario.add) {
      run(
        `kick add ${scenario.add.join(' ')}`,
        'pnpm',
        ['exec', 'kick', 'add', ...scenario.add],
        server,
      )
    }
    run('kick typegen', 'pnpm', ['exec', 'kick', 'typegen'], server)
    run('tsc --noEmit', 'pnpm', ['exec', 'tsc', '--noEmit'], server)
    if (scenario.fullstack) run('web build', 'pnpm', ['run', 'build'], join(root, 'web'))
    // The inertia template's build script also builds the pages and the SSR bundle.
    if (scenario.buildScript) run('build', 'pnpm', ['run', 'build'], server)
    else run('kick build', 'pnpm', ['exec', 'kick', 'build'], server)
    await boot(server, scenario.get)
    if (scenario.deploy) await deployBuilds(root, scenario.get, scenario.contains)
    if (scenario.docker) await dockerImage(name, root, scenario.get, scenario.contains)
    return true
  } catch (err) {
    console.log(`✗ ${name}: ${err.message}`)
    return false
  } finally {
    if (!process.env.KEEP_MATRIX) rmSync(work, { recursive: true, force: true })
  }
}

const argv = process.argv.slice(2)
if (argv.includes('--list')) {
  const list = Object.keys(SCENARIOS)
  console.log(argv.includes('--json') ? JSON.stringify(list) : list.join('\n'))
  process.exit(0)
}
const names = argv.length > 0 ? argv : Object.keys(SCENARIOS)
const unknown = names.filter((n) => !SCENARIOS[n])
if (unknown.length > 0) {
  console.error(`Unknown scenario(s): ${unknown.join(', ')}. Try --list.`)
  process.exit(2)
}
if (!existsSync(join(ROOT, 'packages/cli/dist'))) {
  console.error('packages/cli/dist is missing — run `pnpm build` first.')
  process.exit(2)
}

const packs = mkdtempSync(join(tmpdir(), 'kick-matrix-packs-'))
const failed = []
try {
  process.stdout.write('Packing workspace packages … ')
  const tarballs = packWorkspace(packs)
  console.log(`${Object.keys(tarballs).length} packed`)
  for (const name of names) {
    if (!(await runScenario(name, SCENARIOS[name], tarballs))) failed.push(name)
  }
} finally {
  rmSync(packs, { recursive: true, force: true })
}
console.log(
  failed.length === 0
    ? `\n✓ ${names.length} scenario(s) passed`
    : `\n✗ ${failed.length}/${names.length} failed: ${failed.join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
