/**
 * `kick g deploy <netlify|vercel|docker…>` — the files a deploy target needs,
 * added when the project needs them rather than by every `kick new`:
 *
 * - netlify: `netlify.toml`, the serverless entry, a `build:netlify` script
 * - vercel:  `vercel.json`, the serverless entry, a `build:vercel` script
 * - docker:  `Dockerfile`, `.dockerignore`
 *
 * A fullstack workspace (a `server/` kick project beside `web/`) gets them
 * where it needs them: config and scripts at the root, the entry in server/.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fillVars, renderLayers } from '../scaffold/overlay'
import { writeFileSafe } from '../utils/fs'
import { confirm } from '../utils/prompts'
import { resolvePackageManager } from '../utils/package-manager'
import { generateDockerfile, generateDockerignore } from './templates/docker'

export const DEPLOY_TARGETS = ['netlify', 'vercel', 'docker'] as const
export type DeployTarget = (typeof DEPLOY_TARGETS)[number]

export interface GenerateDeployOptions {
  /** The project — or, for a fullstack app, the workspace root. */
  dir: string
  targets: readonly DeployTarget[]
  /** Overwrite existing files without asking. */
  force?: boolean
  /** Package manager; detected when omitted. */
  pm?: string
}

const KICK_CONFIGS = ['kick.config.ts', 'kick.config.js', 'kick.config.mjs', 'kick.config.json']
const hasKickConfig = (dir: string) => KICK_CONFIGS.some((f) => existsSync(join(dir, f)))

/** A fullstack workspace root: a kick project in server/, a frontend in web/. */
export function isWorkspaceRoot(dir: string): boolean {
  return hasKickConfig(join(dir, 'server')) && existsSync(join(dir, 'web'))
}

/** Parse `"netlify, docker"` / `['netlify', 'docker']`, rejecting unknown names. */
export function parseDeployTargets(input: string | readonly string[]): DeployTarget[] {
  const names = (typeof input === 'string' ? input.split(',') : input)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const unknown = names.filter((name) => !DEPLOY_TARGETS.includes(name as DeployTarget))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown deploy target: ${unknown.join(', ')} — expected ${DEPLOY_TARGETS.join(', ')}`,
    )
  }
  return [...new Set(names)] as DeployTarget[]
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, 'utf-8'))
}

/** `build:netlify` / `build:vercel` for a fullstack workspace root. */
function workspaceScript(pm: string, platform: 'netlify' | 'vercel'): string {
  return pm === 'pnpm'
    ? `pnpm build && pnpm --filter ./server exec kick build:${platform}`
    : `${pm} run build && cd server && kick build:${platform}`
}

/** Write the files and scripts `targets` need; returns the paths written. */
export async function generateDeploy(options: GenerateDeployOptions): Promise<string[]> {
  const { dir, targets } = options
  const workspace = isWorkspaceRoot(dir)
  if (!workspace && !hasKickConfig(dir)) {
    throw new Error(
      `${dir} is not a KickJS project (no kick.config) — run kick g deploy from the project, or from a fullstack workspace's root.`,
    )
  }
  const app = workspace ? join(dir, 'server') : dir
  const pkgFile = join(dir, 'package.json')
  const pkg = readJson(pkgFile)
  const appPkg = workspace ? readJson(join(app, 'package.json')) : pkg
  const pm = await resolvePackageManager(options.pm, dir)
  const deps = { ...appPkg.dependencies, ...appPkg.devDependencies }
  const inertia = '@forinda/kickjs-inertia' in deps

  const files = new Map<string, string>()
  const scripts: Record<string, string> = {}
  const serverless = () => {
    for (const [path, text] of renderLayers(['deploy-serverless']).files) {
      files.set(join(app, path), text)
    }
  }
  const platform = (name: 'netlify' | 'vercel', layer: string) => {
    const rendered = fillVars(renderLayers([layer]).files, {
      packageManager: pm,
      // Netlify serves this before the function: an Inertia app's built
      // pages, else an empty directory so nothing shadows the API.
      netlifyPublish: inertia ? 'dist/client' : 'dist/public',
    })
    for (const [path, text] of rendered) files.set(join(dir, path), text)
    serverless()
    scripts[`build:${name}`] = workspace
      ? workspaceScript(pm, name)
      : // After the project's own build — an Inertia app's also builds the pages.
        `${pkg.scripts?.build ?? 'kick build'} && kick build:${name}`
  }

  for (const target of targets) {
    if (target === 'netlify') {
      platform('netlify', workspace ? 'deploy-netlify-workspace' : 'deploy-netlify')
    } else if (target === 'vercel') {
      platform('vercel', 'deploy-vercel')
    } else {
      const kind = workspace ? 'fullstack' : inertia ? 'inertia' : 'api'
      files.set(
        join(dir, 'Dockerfile'),
        generateDockerfile(kind, pm, String(pkg.name ?? 'app'), pkg.packageManager),
      )
      files.set(join(dir, '.dockerignore'), generateDockerignore())
    }
  }

  const written: string[] = []
  for (const [file, text] of files) {
    if (existsSync(file) && !options.force) {
      // The serverless entry is shared by Netlify and Vercel: one already
      // there is the one to keep.
      if (file.endsWith(join('src', 'serverless.ts'))) continue
      const overwrite = await confirm({
        message: `${relative(dir, file)} already exists. Overwrite?`,
        initialValue: false,
      })
      if (!overwrite) continue
    }
    await writeFileSafe(file, text)
    written.push(file)
  }

  // Scripts: added, never replacing one the project already has.
  const missing = Object.entries(scripts).filter(([name]) => !pkg.scripts?.[name])
  if (missing.length > 0) {
    pkg.scripts = { ...pkg.scripts, ...Object.fromEntries(missing) }
    await writeFileSafe(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
    written.push(pkgFile)
  }
  return written
}
