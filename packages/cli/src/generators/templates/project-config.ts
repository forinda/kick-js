import { execFileSync } from 'node:child_process'
// `SchemaLib` is defined next to `resolveSchemaLib` in ../../config, so the
// scaffold that installs the library and the generators that import from it
// read the same list. Re-exported here for existing importers.
export type { SchemaLib } from '../../config'

/**
 * Map of package name → semver range string (`^x.y.z`). Resolved
 * from `npm view <name> version` upstream so per-package independent
 * versioning is honoured at scaffold time. Every package a scaffold layer
 * lists must appear here; missing keys throw during package.json generation
 * (loud failure beats silently shipping `^undefined`).
 */
export type SiblingVersions = Record<string, string>

function take(versions: SiblingVersions, name: string): string {
  const v = versions[name]
  if (!v) {
    throw new Error(
      `generatePackageJson: missing resolved version for ${name}. ` +
        `Add it to SIBLING_PACKAGES or THIRD_PARTY_PACKAGES in generators/project.ts.`,
    )
  }
  return v
}

/** Name → resolved range, sorted by name (the order npm and pnpm write). */
function pinned(names: readonly string[], versions: SiblingVersions): Record<string, string> {
  return Object.fromEntries(names.toSorted().map((name) => [name, take(versions, name)]))
}

/**
 * Generate package.json. Which packages it lists comes from the scaffold
 * layers (`templates/<layer>/feature.json`); the ranges come from `versions`.
 */
/**
 * `pnpm@11.24.0` for the package manager on this machine, for package.json's
 * `packageManager`: corepack then installs that same version in CI and in
 * the Docker image, so the lockfile is read by the tool that wrote it.
 * Undefined when the version can't be read.
 */
export function packageManagerSpec(pm: string): string | undefined {
  try {
    const version = execFileSync(pm, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim()
    return /^\d+\.\d+\.\d+$/.test(version) ? `${pm}@${version}` : undefined
  } catch {
    return undefined
  }
}

/** `[major, minor]` of a `packageManager` spec — `yarn@4.1.0` → `[4, 1]`. */
export function specVersion(spec: string | undefined): [number, number] | undefined {
  const match = spec?.match(/@(\d+)\.(\d+)\./)
  return match ? [Number(match[1]), Number(match[2])] : undefined
}

/**
 * Yarn 2+ installs with Plug'n'Play by default: no `node_modules`, which the
 * CLI (typecheck, typegen, deploy), Vite and the Dockerfile all read. Yarn
 * reads this file before it installs, so it goes in with the project.
 */
export function yarnrc(pm: string, spec: string | undefined): string | undefined {
  const major = specVersion(spec)?.[0]
  return pm === 'yarn' && major !== undefined && major >= 2
    ? 'nodeLinker: node-modules\n'
    : undefined
}

export function generatePackageJson(
  name: string,
  versions: SiblingVersions,
  packages: {
    dependencies: readonly string[]
    devDependencies: readonly string[]
    /** Scripts a scaffold layer adds or replaces. */
    scripts?: Record<string, string>
  },
  packageManager?: string,
): string {
  return JSON.stringify(
    {
      name,
      ...(packageManager ? { packageManager } : {}),
      // Project starts at 0.0.0 — adopters bump as they ship. Tying
      // the project version to the CLI version (the previous
      // behaviour) made every scaffolded app `5.4.0` on day one,
      // which broke npm publishing for adopters trying their first
      // release.
      version: '0.0.0',
      type: 'module',
      scripts: {
        // `kick dev` (not bare `vite`): it boots Vite itself AND owns the
        // typegen-on-save watcher. Plain `vite` gives working HMR but
        // frozen `.kickjs/types` — new routes silently lose their typing
        // until a manual `kick typegen`.
        // Four scripts, not ten. Everything dropped from here is still one
        // command away — `kick dev:debug`, `kick typegen`, `pnpm exec vitest`,
        // `pnpm exec tsc --noEmit` — and a scaffold that opens with a wall of
        // aliases teaches less than one that shows the binary.
        //
        // `lint: 'eslint src/'` used to be here without eslint ever being a
        // dependency, so `lint` failed with "command not found" in every
        // generated project.
        dev: 'kick dev',
        build: 'kick build',
        start: 'kick start',
        test: 'vitest run --passWithNoTests',
        // Deploy scripts come with `kick g deploy netlify | vercel`.
        ...packages.scripts,
      },
      dependencies: pinned(packages.dependencies, versions),
      devDependencies: pinned(packages.devDependencies, versions),
    },
    null,
    2,
  )
}

/**
 * Answer pnpm's build-script approvals for `builds` in pnpm-workspace.yaml text,
 * in both formats pnpm has used, so any pnpm 10+ reads them:
 *
 * - `allowBuilds` (pnpm 10.26+; pnpm 11 reads only this)
 * - `onlyBuiltDependencies` / `ignoredBuiltDependencies` (pnpm before 10.26)
 *
 * Each version ignores the format it doesn't read. An existing answer wins: an
 * `allowBuilds` key set to true/false, or a name already in either list, is left
 * alone. A missing key or pnpm's `set this to true or false` placeholder is filled in.
 */
export function setAllowBuilds(yaml: string, builds: Record<string, boolean>): string {
  const entries = Object.entries(builds)
  if (entries.length === 0) return yaml
  const lines = yaml === '' ? [] : yaml.replace(/\n$/, '').split('\n')
  const unquote = (text: string) => text.trim().replace(/^['"]|['"]$/g, '')
  const quote = (name: string) => (/^[\w-]+$/.test(name) ? name : `'${name}'`)

  /** Line range of a top-level block's indented entries; appended when missing and `create`. */
  const block = (key: string, create: boolean): { start: number; end: number } | undefined => {
    let start = lines.findIndex((line) => line.replace(/\s+$/, '') === `${key}:`)
    if (start === -1) {
      if (!create) return undefined
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push(`${key}:`)
      start = lines.length - 1
    }
    // The block runs to the next unindented line; blank lines inside it don't end it.
    let end = start + 1
    for (let i = start + 1; i < lines.length && /^(\s|$)/.test(lines[i]); i++) {
      if (lines[i].trim() !== '') end = i + 1
    }
    return { start, end }
  }

  const answers: Array<[string, boolean]> = []
  for (const [name, allow] of entries) {
    const { start, end } = block('allowBuilds', true)!
    const index = lines
      .slice(start + 1, end)
      .findIndex((line) => unquote(line.split(':')[0]) === name)
    const answered =
      index === -1 ? undefined : /:\s*(true|false)\s*$/.exec(lines[start + 1 + index])
    if (answered) {
      answers.push([name, answered[1] === 'true'])
      continue
    }
    const entry = `  ${quote(name)}: ${allow}`
    if (index === -1) lines.splice(end, 0, entry)
    else lines[start + 1 + index] = entry
    answers.push([name, allow])
  }

  const lists = ['onlyBuiltDependencies', 'ignoredBuiltDependencies']
  for (const [name, allow] of answers) {
    const listed = lists.some((key) => {
      const range = block(key, false)
      return (
        range !== undefined &&
        lines
          .slice(range.start + 1, range.end)
          .some((line) => unquote(line.replace(/^\s*-/, '')) === name)
      )
    })
    if (listed) continue
    const { end } = block(allow ? lists[0] : lists[1], true)!
    lines.splice(end, 0, `  - ${quote(name)}`)
  }
  return `${lines.join('\n')}\n`
}
