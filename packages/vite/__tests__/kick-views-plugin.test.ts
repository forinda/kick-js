import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, createServer, type Plugin, type Rollup } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { kickViewsPlugin, type KickViewsPluginOptions } from '../src/kick-views-plugin'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-views-build-'))
  const all = { 'entry.ts': "export { default } from 'virtual:kick-views'", ...files }
  for (const [name, src] of Object.entries(all)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), src)
  }
  return root
}

async function bundle(root: string, opts: KickViewsPluginOptions = {}): Promise<string> {
  const out = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    // File contents inspected in the bundle; disk mode has its own tests.
    plugins: [kickViewsPlugin({ clientFiles: 'bundle', ...opts })],
    build: { ssr: join(root, 'entry.ts'), write: false, minify: false },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[]
  const output = (Array.isArray(out) ? out[0]! : out).output
  return output.map((c) => ('code' in c ? c.code : '')).join('\n')
}

/** A real build to `dist/`: the server entry plus whatever the plugin writes. */
async function buildToDisk(
  root: string,
  opts: KickViewsPluginOptions | Plugin = {},
  emptyOutDir = true,
): Promise<string> {
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    // A plugin instance, reused: one `vite build --watch` session.
    plugins: ['name' in opts ? opts : kickViewsPlugin(opts)],
    build: { ssr: join(root, 'entry.ts'), outDir: join(root, 'dist'), minify: false, emptyOutDir },
  })
  return readFileSync(join(root, 'dist/entry.mjs'), 'utf8')
}

const PHOTO = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256)

const diskProject = () =>
  project({
    'src/views/components/toast-a.kick':
      "<div></div>\n<script client>\nimport { fmt } from './date.utils'\nimport './a.css'\nimport photo from './photo.png'\nimport icon from './icon.svg'\nconsole.log(fmt('a'), photo, icon)\n</script>",
    'src/views/components/toast-b.kick':
      "<div></div>\n<script client>\nimport { fmt } from './date.utils'\nconsole.log(fmt('b'))\n</script>",
    'src/views/components/date.utils.ts': 'export const fmt = (s: string) => `<${s}>`',
    'src/views/components/a.css': 'div { color: red }',
    'src/views/components/icon.svg': `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(40)}</svg>`,
  })

describe('client files on disk', () => {
  it('writes client files to dist/public/_kick/c', async () => {
    const root = diskProject()
    writeFileSync(join(root, 'src/views/components/photo.png'), PHOTO)
    const code = await buildToDisk(root)
    const dir = join(root, 'dist/public/_kick/c')
    const written = readdirSync(dir).toSorted()
    expect(written.some((f) => /^toast-a\.[\w-]{8}\.js$/.test(f))).toBe(true)
    expect(written.some((f) => /^toast-b\.[\w-]{8}\.js$/.test(f))).toBe(true)
    expect(written.some((f) => /^date_utils\.[\w-]{8}\.js$/.test(f))).toBe(true)
    expect(written.some((f) => f.endsWith('.css'))).toBe(true)
    const png = written.find((f) => f.endsWith('.png'))!
    expect(new Uint8Array(readFileSync(join(dir, png)))).toEqual(PHOTO)
    const disk = JSON.parse(/"disk": (\[[^\]]*\])/.exec(code)![1]!) as string[]
    expect(disk.toSorted()).toEqual(written)
    expect(
      readFileSync(
        join(
          dir,
          written.find((f) => f.startsWith('toast-a'))!,
        ),
        'utf8',
      ),
    ).toContain('data:image/svg+xml')
    expect(code).not.toContain('"files"')
  })

  it('clientDir points at the emitted folder', async () => {
    const root = diskProject()
    writeFileSync(join(root, 'src/views/components/photo.png'), PHOTO)
    await buildToDisk(root)
    const mod = await import(pathToFileURL(join(root, 'dist/entry.mjs')).href)
    const entry = mod.default.bundle.client.entries['toast-a'] as string
    expect(existsSync(new URL(entry, mod.default.clientDir))).toBe(true)
  })

  it('bundle mode keeps files in the bundle', async () => {
    const root = diskProject()
    writeFileSync(join(root, 'src/views/components/photo.png'), PHOTO)
    const code = await buildToDisk(root, { clientFiles: 'bundle' })
    expect(code).toContain('"files"')
    expect(code).not.toContain('"disk"')
    expect(existsSync(join(root, 'dist/public'))).toBe(false)
    expect(code).toContain('data:image/png')
  })

  it('upper-case asset extensions are written lower-case, so they can be served', async () => {
    const root = project({
      'src/views/components/a-b.kick':
        "<div></div>\n<script client>\nimport logo from './Logo.PNG'\nconsole.log(logo)\n</script>",
    })
    writeFileSync(join(root, 'src/views/components/Logo.PNG'), PHOTO)
    await buildToDisk(root)
    const written = readdirSync(join(root, 'dist/public/_kick/c'))
    expect(written.some((f) => /^Logo\.[\w-]{8}\.png$/.test(f))).toBe(true)
  })

  it('publicDir and clientScriptPath move the folder', async () => {
    const root = diskProject()
    writeFileSync(join(root, 'src/views/components/photo.png'), PHOTO)
    await buildToDisk(root, { publicDir: 'static', clientScriptPath: '/assets/c' })
    expect(readdirSync(join(root, 'dist/static/assets/c')).length).toBeGreaterThan(3)
  })

  it('an absolute publicDir is used as is', async () => {
    const root = diskProject()
    writeFileSync(join(root, 'src/views/components/photo.png'), PHOTO)
    const publicDir = join(root, 'www')
    await buildToDisk(root, { publicDir })
    expect(readdirSync(join(publicDir, '_kick/c')).length).toBeGreaterThan(3)
    const mod = await import(pathToFileURL(join(root, 'dist/entry.mjs')).href)
    const entry = mod.default.bundle.client.entries['toast-a'] as string
    expect(existsSync(new URL(entry, mod.default.clientDir))).toBe(true)
  })

  it('a rebuild drops the files the last build wrote, and only those', async () => {
    const root = project({
      'src/views/components/a-b.kick': '<div></div>\n<script client>\nconsole.log(1)\n</script>',
    })
    // As in `vite build --watch`: one plugin, and the outDir isn't emptied between builds.
    const plugin = kickViewsPlugin()
    await buildToDisk(root, plugin, false)
    const dir = join(root, 'dist/public/_kick/c')
    const before = readdirSync(dir)
    // Shaped like a client file, but not one this plugin wrote.
    writeFileSync(join(dir, 'other.abcd1234.js'), 'keep me')
    writeFileSync(
      join(root, 'src/views/components/a-b.kick'),
      '<div></div>\n<script client>\nconsole.log(2)\n</script>',
    )
    await buildToDisk(root, plugin, false)
    const after = readdirSync(dir)
    expect(after.some((f) => before.includes(f))).toBe(false)
    expect(after).toContain('other.abcd1234.js')
    expect(after).toHaveLength(before.length + 1)

    // The last template gone: its files go too.
    rmSync(join(root, 'src/views'), { recursive: true })
    await buildToDisk(root, plugin, false)
    expect(readdirSync(dir)).toEqual(['other.abcd1234.js'])
  })
})

describe('kickViewsPlugin', () => {
  it('bundles imports into shared chunks', async () => {
    const comp = (tag: string) =>
      `<div></div>\n<script client>\nimport { count } from './shared'\nconst n: number = count\ncustomElements.define('${tag}-el', class extends HTMLElement {})\nconsole.log(n)\n</script>`
    const code = await bundle(
      project({
        'src/views/components/toast-a.kick': comp('toast-a'),
        'src/views/components/toast-b.kick': comp('toast-b'),
        'src/views/components/shared.ts': 'export let count = 41\ncount++\n',
        'src/views/home.kick': '<toast-a /><toast-b />',
      }),
    )
    const a = /"toast-a": ?"(toast-a\.[A-Za-z0-9_-]{8}\.js)"/.exec(code)
    const b = /"toast-b": ?"(toast-b\.[A-Za-z0-9_-]{8}\.js)"/.exec(code)
    expect(a && b).toBeTruthy()
    // One shared chunk holds the helper; both entries import it.
    const chunk = /"(shared\.[A-Za-z0-9_-]{8}\.js)":/.exec(code)
    expect(chunk).toBeTruthy()
    expect(code.split(chunk![1]!).length - 1).toBeGreaterThanOrEqual(3)
    expect(code).not.toContain(': number')
  })

  it('build ships plain JavaScript', async () => {
    const code = await bundle(
      project({
        'src/views/components/flash-toast.kick':
          "<kick-toast>hi</kick-toast>\n<script client>\nconst n: number = 1\ncustomElements.define('kick-toast', class extends HTMLElement {})\n</script>",
        'src/views/home.kick': '<flash-toast />',
      }),
    )
    expect(code).toMatch(/"js": ?true/)
    expect(code).toContain('customElements.define(')
    expect(code).toContain('kick-toast')
    expect(code).not.toContain(': number')
  })

  it('build fails on a broken template', async () => {
    const root = project({ 'src/views/bad.kick': '{{ a() }}', 'src/views/ok.kick': 'ok' })
    await expect(bundle(root)).rejects.toThrow(/bad\.kick:1:\d+.*calls aren't allowed/s)
  })

  it('build fails on a broken template even when nothing imports the virtual module', async () => {
    const root = project({ 'src/views/bad.kick': '{{ a() }}' })
    writeFileSync(join(root, 'entry.ts'), 'export const x = 1')
    await expect(bundle(root)).rejects.toThrow(/bad\.kick:1:\d+.*calls aren't allowed/s)
  })

  it('emits data, not code', async () => {
    const root = project({
      'src/views/home.kick': "@layout('layouts/main')\n<h1>{{ t | initials }}</h1>",
      'src/views/layouts/main.kick': '<main><slot /></main>',
      'src/views/pipes.ts': 'export const initials = (v: string) => v[0]',
    })
    const code = await bundle(root)
    expect(code).toContain('"v": 1')
    expect(code).toContain('"layouts/main"')
    expect(code).toMatch(/initials/)
    // the template body is data: no functions generated from it
    const data = code.slice(
      code.indexOf('const bundle'),
      code.indexOf('};', code.indexOf('const bundle')),
    )
    expect(data).not.toMatch(/function|=>/)
  })

  it('an unknown pipe fails the build', async () => {
    const root = project({ 'src/views/p.kick': '{{ x | nope }}' })
    await expect(bundle(root)).rejects.toThrow(/unknown pipe 'nope'/)
  })

  it('dev serves client scripts through Vite, imports resolved', async () => {
    const root = project({
      'src/views/components/flash-toast.kick':
        "<kick-toast></kick-toast>\n<script client>\nimport './toast.css'\nimport { count } from './shared'\nconst n: number = count\nconsole.log(n)\n</script>",
      'src/views/components/shared.ts': 'export const count = 1',
      'src/views/components/toast.css': 'kick-toast { color: plum }',
      'src/views/home.kick': '<flash-toast />',
    })
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      plugins: [kickViewsPlugin()],
      server: { middlewareMode: true, ws: false },
    })
    const http = createHttpServer(vite.middlewares)
    await new Promise<void>((r) => http.listen(0, r))
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
    try {
      const res = await fetch(`${base}/_kick/c/flash-toast.00000000.js`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/javascript/)
      const js = await res.text()
      expect(js).toContain('/src/views/components/shared.ts')
      expect(js).not.toContain(': number')
      // CSS imports go through Vite too: a module that injects the stylesheet.
      const css = await fetch(`${base}/src/views/components/toast.css`)
      expect(css.status).toBe(200)
      expect(await css.text()).toContain('plum')
      // Not a component's script: left for the app.
      expect((await fetch(`${base}/_kick/c/nope.00000000.js`)).status).toBe(404)
      // An edit to the template's script shows on the next load.
      writeFileSync(
        join(root, 'src/views/components/flash-toast.kick'),
        "<kick-toast></kick-toast>\n<script client>\nconsole.log('edited-version')\n</script>",
      )
      vite.watcher.emit('change', join(root, 'src/views/components/flash-toast.kick'))
      expect(await (await fetch(`${base}/_kick/c/flash-toast.00000000.js`)).text()).toContain(
        'edited-version',
      )
    } finally {
      http.close()
      await vite.close()
    }
  })

  it('servable names for chunks from dotted modules', async () => {
    const comp = (tag: string) =>
      `<div></div>\n<script client>\nimport { fmt } from './date.utils'\nconsole.log(fmt('${tag}'))\n</script>`
    const code = await bundle(
      project({
        'src/views/components/toast-a.kick': comp('a'),
        'src/views/components/toast-b.kick': comp('b'),
        'src/views/components/date.utils.ts': 'export const fmt = (s: string) => `<${s}>`',
      }),
    )
    const files = [...code.matchAll(/"([^"/]+\.js)": "/g)].map((m) => m[1]!)
    expect(files.length).toBeGreaterThanOrEqual(3)
    for (const f of files) expect(f).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8}\.js$/)
    // The bundle's files are what ships: templates don't carry the source again.
    expect(code).not.toContain('./date.utils')
  })

  it("hands the views the plugin's clientScriptPath", async () => {
    const root = project({ 'src/views/page.kick': '<p>hi</p>' })
    expect(await bundle(root, { clientScriptPath: '/assets/c/' })).toMatch(
      /clientScriptPath[:=]\s*"\/assets\/c"/,
    )
  })

  it('bundles imported CSS and inlines images', async () => {
    const code = await bundle(
      project({
        'src/views/components/a-b.kick':
          "<div></div>\n<script client>\nimport './a.css'\nimport icon from './icon.svg'\nconsole.log(icon)\n</script>",
        'src/views/components/a.css': 'div { color: red }',
        'src/views/components/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      }),
    )
    const css = /"a-b": \[\s*"(a-b\.[A-Za-z0-9_-]{8}\.css)"/.exec(code)?.[1]
    expect(css).toBeTruthy()
    expect(code).toMatch(new RegExp(`"${css!.replace(/\./g, '\\.')}": "[^"]*color:\\s*red`))
    expect(code).toContain('data:image/svg+xml')
  })

  it("applies the app's define and mode to client scripts", async () => {
    const root = project({
      'src/views/components/a-b.kick':
        '<div></div>\n<script client>\nconsole.log(__FLAG__, import.meta.env.MODE)\n</script>',
    })
    const out = (await build({
      root,
      configFile: false,
      logLevel: 'silent',
      mode: 'staging',
      define: { __FLAG__: JSON.stringify('flag-on') },
      plugins: [kickViewsPlugin({ clientFiles: 'bundle' })],
      build: { ssr: join(root, 'entry.ts'), write: false, minify: false },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]
    const code = (Array.isArray(out) ? out[0]! : out).output
      .map((c) => ('code' in c ? c.code : ''))
      .join('\n')
    expect(code).toContain('flag-on')
    expect(code).toContain('staging')
  })

  it('only resolves client-script modules inside the views folder', async () => {
    const root = project({
      'src/views/components/a-b.kick': '<div></div><script client>let a = 1</script>',
    })
    const outside = project({ 'secret.kick': '<script client>leak</script>' })
    const plugin = kickViewsPlugin() as any
    plugin.configResolved({ root, command: 'serve', resolve: { alias: [] } })
    const inside = join(root, 'src/views/components/a-b.kick.client.ts')
    expect(plugin.resolveId(inside)).toBe(inside)
    const escaped = join(outside, 'secret.kick.client.ts')
    expect(plugin.resolveId(escaped)).toBeUndefined()
    expect(await plugin.load(escaped)).toBeUndefined()
  })

  it('dev serves no bundle: the file loader reads templates', async () => {
    const root = project({ 'src/views/home.kick': 'x' })
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [kickViewsPlugin()],
      server: { middlewareMode: true, ws: false },
    })
    try {
      const mod = (await server.ssrLoadModule('/entry.ts')) as {
        default: { bundle: unknown; pipes: object }
      }
      expect(mod.default.bundle).toBeNull()
      expect(mod.default.pipes).toEqual({})
    } finally {
      await server.close()
    }
  })
})

describe('validators.ts', () => {
  const PHONE =
    "import { digits } from './digits'\nexport const phone = (v: string) => (digits.test(v) ? undefined : 'Enter a phone number')\n"
  const DIGITS = 'export const digits = /^\\+?\\d{9,15}$/ // phone-pattern\n'

  it('bundles validators with no component scripts', async () => {
    const root = project({
      'src/views/page.kick': '<input name="p" validate="required | phone">',
      'src/views/validators.ts': PHONE,
      'src/views/digits.ts': DIGITS,
    })
    await buildToDisk(root)
    const dir = join(root, 'dist/public/_kick/c')
    const file = readdirSync(dir).find((f) => /^kick-validators\.[\w-]{8}\.js$/.test(f))!
    expect(file).toBeTruthy()
    const js = readFileSync(join(dir, file), 'utf8')
    expect(js).toContain('__kickValidators')
    // Not tree-shaken: the function and what it imports ship.
    expect(js).toContain('Enter a phone number')
    expect(js).toContain('\\d{9,15}')
    const mod = await import(pathToFileURL(join(root, 'dist/entry.mjs')).href)
    expect(mod.default.bundle.client.entries['kick-validators']).toBe(file)
  })

  it('bundle mode keeps validators in files', async () => {
    const root = project({
      'src/views/page.kick': '<input name="p" validate="phone">',
      'src/views/validators.ts': PHONE,
      'src/views/digits.ts': DIGITS,
    })
    const code = await bundle(root)
    expect(code).toMatch(/"kick-validators": "kick-validators\.[\w-]{8}\.js"/)
    expect(code).toContain('Enter a phone number')
  })

  it('a watch build watches validators.ts, before it exists too, and what it imports', async () => {
    const watched = async (root: string) => {
      const files: string[] = []
      const plugin = kickViewsPlugin({ clientFiles: 'bundle' }) as any
      plugin.configResolved({ root, command: 'build', build: {} })
      await plugin.buildStart.call({
        addWatchFile: (f: string) => files.push(f),
        warn: () => {},
        error: (m: string) => {
          throw new Error(m)
        },
      })
      return files
    }
    const withIt = project({
      'src/views/page.kick': '<input name="p" validate="phone">',
      // `unused` is tree-shaken out: its file is still watched, a later edit may use it.
      'src/views/validators.ts': `import { unused } from './unused'\nconst dead = () => unused\n${PHONE}`,
      'src/views/digits.ts': DIGITS,
      'src/views/unused.ts': 'export const unused = 1\n',
    })
    const files = await watched(withIt)
    expect(files).toContain(join(withIt, 'src/views/validators.ts'))
    expect(files).toContain(join(withIt, 'src/views/digits.ts'))
    expect(files).toContain(join(withIt, 'src/views/unused.ts'))
    const without = project({ 'src/views/page.kick': '<input name="p" validate="required">' })
    expect(await watched(without)).toContain(join(without, 'src/views/validators.ts'))
  })

  it('unknown validator fails the build', async () => {
    const root = project({ 'src/views/page.kick': '<input name="p" validate="phone">' })
    await expect(bundle(root)).rejects.toThrow("unknown validator 'phone'")
  })

  it('built-in name in validators.ts fails the build', async () => {
    const root = project({
      'src/views/page.kick': '<p></p>',
      'src/views/validators.ts': 'export const email = () => undefined',
    })
    await expect(bundle(root)).rejects.toThrow("'email' is a built-in validator")
  })

  it('dev serves validators.ts through Vite', async () => {
    const root = project({
      'src/views/page.kick': '<input name="p" validate="phone">',
      'src/views/validators.ts': PHONE,
      'src/views/digits.ts': DIGITS,
    })
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      plugins: [kickViewsPlugin()],
      server: { middlewareMode: true, ws: false },
    })
    const http = createHttpServer(vite.middlewares)
    await new Promise<void>((r) => http.listen(0, r))
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
    try {
      const res = await fetch(`${base}/_kick/c/kick-validators.00000000.js`)
      expect(res.status).toBe(200)
      const wrapper = await res.text()
      expect(wrapper).toContain('__kickValidators')
      expect(wrapper).toContain('/src/views/validators.ts')
      const mod = await (await fetch(`${base}/src/views/validators.ts`)).text()
      expect(mod).toContain('Enter a phone number')
      expect(mod).not.toContain(': string')
      writeFileSync(
        join(root, 'src/views/validators.ts'),
        "export const phone = (v) => (v ? undefined : 'edited-version')\n",
      )
      vite.watcher.emit('change', join(root, 'src/views/validators.ts'))
      // Vite invalidates the module asynchronously: the next request after that has the edit.
      await vi.waitFor(
        async () =>
          expect(await (await fetch(`${base}/src/views/validators.ts`)).text()).toContain(
            'edited-version',
          ),
        { timeout: 5000 },
      )
    } finally {
      http.close()
      await vite.close()
    }
  })
})

describe('validators.ts module ids', () => {
  it('the wrapper loads however Vite spells its id', async () => {
    const root = project({ 'src/views/validators.ts': 'export const phone = () => undefined' })
    const plugin = kickViewsPlugin()
    ;(plugin.configResolved as (c: unknown) => void)({
      root,
      command: 'serve',
      mode: 'development',
    })
    // Vite normalises resolved ids (forward slashes on Windows): not the string the plugin built.
    const id = `${root}/src/views/../views/kick-validators.client.ts`
    const resolveId = plugin.resolveId as (id: string) => string | undefined
    const load = plugin.load as (id: string) => Promise<string | undefined>
    expect(resolveId(id)).toBe(id)
    expect(await load(id)).toContain('__kickValidators')
  })
})

describe('validators.ts under kick dev', () => {
  it('hands createViews the plugin’s validatorsFile, so dev reads the file the build bundles', async () => {
    const root = project({ 'src/forms/checks.ts': 'export const phone = () => undefined' })
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      plugins: [kickViewsPlugin({ validatorsFile: 'src/forms/checks.ts' })],
      server: { middlewareMode: true, ws: false },
    })
    try {
      const mod = await vite.ssrLoadModule('virtual:kick-views')
      expect(mod.default.validatorsFile).toBe(join(root, 'src/forms/checks.ts'))
      expect(mod.default.bundle).toBeNull()
    } finally {
      await vite.close()
    }
  })

  it('a build hands over no validatorsFile: the bundle has the script', async () => {
    const root = project({
      'src/views/page.kick': '<input name="p" validate="phone">',
      'src/views/validators.ts': 'export const phone = () => undefined',
    })
    const code = await bundle(root)
    expect(code).not.toContain('validatorsFile:')
  })
})

describe('validators.ts beside a moved views folder', () => {
  it('defaults to <viewsDir>/validators.ts, as the editor and check:views do', async () => {
    const root = project({
      'app/views/page.kick': '<input name="p" validate="phone">',
      'app/views/validators.ts': 'export const phone = () => undefined',
    })
    const code = await bundle(root, { viewsDir: 'app/views' })
    expect(code).toMatch(/"kick-validators": "kick-validators\.[\w-]{8}\.js"/)
  })
})
