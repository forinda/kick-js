/** `kick g deploy`: the files and scripts each target needs, for each kind of project. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { generateDeploy, parseDeployTargets } from '../src/generators/deploy'
import { setFormatOnWrite } from '../src/utils/fs'

beforeAll(() => setFormatOnWrite(false))

function project(pkg: Record<string, unknown>, dir = mkdtempSync(join(tmpdir(), 'kick-deploy-'))) {
  writeFileSync(join(dir, 'kick.config.ts'), 'export default {}\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  return dir
}
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf-8')
const scripts = (dir: string) => JSON.parse(read(dir, 'package.json')).scripts

describe('generateDeploy', () => {
  it('an API project: config, entry, scripts after its build, Dockerfile', async () => {
    const dir = project({ name: 'api', scripts: { build: 'kick build' } })
    await generateDeploy({ dir, targets: ['netlify', 'vercel', 'docker'], pm: 'pnpm' })

    expect(read(dir, 'netlify.toml')).toContain('command = "pnpm run build:netlify"')
    expect(read(dir, 'netlify.toml')).toContain('publish = "dist/public"')
    expect(read(dir, 'vercel.json')).toContain('pnpm run build:vercel')
    expect(read(dir, 'src/serverless.ts')).toContain('createHandler(')
    expect(scripts(dir)).toMatchObject({
      build: 'kick build',
      'build:netlify': 'kick build && kick build:netlify',
      'build:vercel': 'kick build && kick build:vercel',
    })
    expect(existsSync(join(dir, 'Dockerfile'))).toBe(true)
    expect(existsSync(join(dir, '.dockerignore'))).toBe(true)
  })

  it('an Inertia project: publishes the built pages, and builds them first', async () => {
    const build = 'kick build && vite build --config vite.client.config.ts'
    const dir = project({
      name: 'pages',
      scripts: { build },
      dependencies: { '@forinda/kickjs-inertia': '^1.0.0' },
    })
    await generateDeploy({ dir, targets: ['netlify'], pm: 'npm' })
    expect(read(dir, 'netlify.toml')).toContain('publish = "dist/client"')
    expect(scripts(dir)['build:netlify']).toBe(`${build} && kick build:netlify`)
  })

  it('a fullstack workspace: config and scripts at the root, the entry in server/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-deploy-ws-'))
    mkdirSync(join(dir, 'server'))
    mkdirSync(join(dir, 'web'))
    project({ name: 'server', dependencies: {} }, join(dir, 'server'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { build: 'x' } }),
    )

    await generateDeploy({ dir, targets: ['netlify', 'docker'], pm: 'pnpm' })
    expect(read(dir, 'netlify.toml')).toContain('publish = "web/dist"')
    expect(existsSync(join(dir, 'server/src/serverless.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src/serverless.ts'))).toBe(false)
    expect(scripts(dir)['build:netlify']).toBe(
      'pnpm build && pnpm --filter ./server exec kick build:netlify',
    )
    expect(existsSync(join(dir, 'Dockerfile'))).toBe(true)
  })

  it('keeps a script and a serverless entry the project already has', async () => {
    const dir = project({ name: 'api', scripts: { build: 'kick build', 'build:vercel': 'mine' } })
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/serverless.ts'), '// mine\n')
    await generateDeploy({ dir, targets: ['vercel'], pm: 'pnpm' })
    expect(scripts(dir)['build:vercel']).toBe('mine')
    expect(read(dir, 'src/serverless.ts')).toBe('// mine\n')
  })

  it('refuses a directory that is not a KickJS project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-deploy-none-'))
    writeFileSync(join(dir, 'package.json'), '{}')
    await expect(generateDeploy({ dir, targets: ['docker'] })).rejects.toThrow(
      /not a KickJS project/,
    )
  })
})

describe('parseDeployTargets', () => {
  it('takes a comma list or an array, and refuses unknown targets', () => {
    expect(parseDeployTargets('netlify, Docker')).toEqual(['netlify', 'docker'])
    expect(parseDeployTargets(['vercel', 'vercel'])).toEqual(['vercel'])
    expect(() => parseDeployTargets('heroku')).toThrow(/Unknown deploy target: heroku/)
  })
})
