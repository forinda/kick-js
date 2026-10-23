import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { clientScriptResponse, createViews, useClientFiles } from '../src/index'
import { check } from '../src/check/check'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

const TOAST_SCRIPT =
  "\nconst n: number = 1\ncustomElements.define('kick-toast', class extends HTMLElement {})\n"

function project(files: Record<string, string>) {
  const templates = new Map(
    Object.entries(files).map(([n, src]) => [n, parse(src, `${n}.kick`).ast]),
  )
  return { templates, pipes: new Set(BUILTIN_PIPES), componentsDir: 'components' }
}

const errors = (files: Record<string, string>, name: string) =>
  check(name, project(files))
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message)

describe('<script client>', () => {
  it('lifts the client script out of a component', () => {
    // The component (flash-toast) renders the custom element its script defines (kick-toast).
    const r = check(
      'components/flash-toast',
      project({
        'components/flash-toast': `<kick-toast><p>hi</p></kick-toast>\n<script client>${TOAST_SCRIPT}</script>`,
      }),
    )
    expect(r.template?.client).toEqual({ code: TOAST_SCRIPT, js: false })
    expect(JSON.stringify(r.template?.body)).not.toContain('<script')
    // Custom elements are expected next to a client script: no "isn't a component" warning.
    expect(r.diagnostics.map((d) => d.message).join('\n')).not.toContain("isn't a component")
  })

  it('other scripts stay inline', () => {
    const r = check(
      'components/a-b',
      project({ 'components/a-b': '<div></div>\n<script>let a = 1</script>' }),
    )
    expect(r.template?.client).toBeUndefined()
    expect(JSON.stringify(r.template?.body)).toContain('<script>')
  })

  it('refuses misplaced or impure client scripts', () => {
    expect(errors({ page: '<script client>let a = 1</script>' }, 'page')).toContain(
      '<script client> is only for components (src/views/components/…)',
    )
    expect(
      errors(
        { 'components/a-b': '<div><script client>let a = 1</script></div>' },
        'components/a-b',
      ),
    ).toContain('<script client> must be at the top level of the component')
    expect(
      errors(
        { 'components/a-b': '<div></div><script client>1</script><script client>2</script>' },
        'components/a-b',
      ),
    ).toContain('a component has one <script client>')
    expect(
      errors(
        { 'components/a-b': '<div></div><script client>let a = {{ x }}</script>' },
        'components/a-b',
      ),
    ).toContain("<script client> can't use {{ }} — pass data through attributes")
  })
})

describe('client files on disk', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255])
  const diskViews = () => {
    const out = mkdtempSync(join(tmpdir(), 'kick-disk-'))
    writeFileSync(join(out, 'flash-toast.AbC_12-x.js'), 'export {}')
    writeFileSync(join(out, 'logo.Lg0_12-x.png'), PNG)
    writeFileSync(join(out, 'secret.Lg0_12-x.png'), PNG)
    const p = project({ 'components/flash-toast': TOAST, page: '<flash-toast />' })
    return createViews({
      bundle: {
        v: 1,
        templates: {
          'components/flash-toast': check('components/flash-toast', p).template!,
          page: check('page', p).template!,
        },
        client: {
          entries: { 'flash-toast': 'flash-toast.AbC_12-x.js' },
          disk: ['flash-toast.AbC_12-x.js', 'logo.Lg0_12-x.png'],
        },
      },
      clientDir: pathToFileURL(`${out}/`).href,
      warn: vi.fn(),
    })
  }

  it('serves binary files from disk with their type', async () => {
    const v = diskViews()
    expect(await v.render('page')).toContain('src="/_kick/c/flash-toast.AbC_12-x.js"')
    const png = await v.clientFile('logo.Lg0_12-x.png')
    expect(png?.type).toBe('image/png')
    expect(new Uint8Array(png!.body as Uint8Array)).toEqual(PNG)
    expect((await v.clientFile('flash-toast.AbC_12-x.js'))?.type).toBe(
      'text/javascript; charset=utf-8',
    )
    const res = await clientScriptResponse(v, new Request('http://x/_kick/c/logo.Lg0_12-x.png'))
    expect(res?.status).toBe(200)
    expect(res?.headers.get('content-type')).toBe('image/png')
    expect(res?.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(PNG)
  })

  it('reads only listed files', async () => {
    const read = vi.fn((url: URL) => readFile(url))
    useClientFiles(read)
    try {
      const v = diskViews()
      for (const bad of ['../x.png', 'secret.Lg0_12-x.png', 'logo.Lg0_12-x.png.map'])
        expect(await v.clientFile(bad)).toBeUndefined()
      expect(read).not.toHaveBeenCalled()
    } finally {
      useClientFiles((url) => readFile(url))
    }
  })

  it('long extensions are served', async () => {
    const v = diskViews()
    expect(await v.clientFile('site.Ab0_12-x.webmanifest')).toBeUndefined() // not listed
    expect(
      (await import('../src/client-scripts')).CLIENT_SCRIPT_FILE.test('site.Ab0_12-x.webmanifest'),
    ).toBe(true)
  })

  it('a listed file missing on disk falls through', async () => {
    const out = mkdtempSync(join(tmpdir(), 'kick-disk-gone-'))
    const p = project({ 'components/flash-toast': TOAST, page: '<flash-toast />' })
    const v = createViews({
      bundle: {
        v: 1,
        templates: { 'components/flash-toast': check('components/flash-toast', p).template! },
        client: { entries: {}, disk: ['gone.Lg0_12-x.png'] },
      },
      clientDir: pathToFileURL(`${out}/`).href,
      warn: vi.fn(),
    })
    expect(await v.clientFile('gone.Lg0_12-x.png')).toBeUndefined()
  })

  it('warns when the bundle lists disk files but no clientDir is given', () => {
    const warn = vi.fn()
    const p = project({ 'components/flash-toast': TOAST })
    createViews({
      bundle: {
        v: 1,
        templates: { 'components/flash-toast': check('components/flash-toast', p).template! },
        client: { entries: {}, disk: ['a.Lg0_12-x.js'] },
      },
      warn,
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clientDir'))
  })

  it('without a reader, disk files fall through', async () => {
    useClientFiles(undefined)
    try {
      expect(await diskViews().clientFile('logo.Lg0_12-x.png')).toBeUndefined()
    } finally {
      useClientFiles((url) => readFile(url))
    }
  })
})

describe('imports', () => {
  it('the checker allows imports', () => {
    for (const code of [
      "import { x } from './x'",
      "const m = await import('./m')",
      "export {\n  a,\n  b\n} from './x'",
    ])
      expect(
        errors(
          { 'components/a-b': `<div></div><script client>${code}</script>` },
          'components/a-b',
        ),
      ).toEqual([])
  })

  it('serves bundled entries and chunks', async () => {
    const files = { 'components/flash-toast': TOAST, page: '<flash-toast />' }
    const p = project(files)
    const v = createViews({
      bundle: {
        v: 1,
        templates: {
          'components/flash-toast': check('components/flash-toast', p).template!,
          page: check('page', p).template!,
        },
        client: {
          entries: { 'flash-toast': 'flash-toast.AbC_12-x.js' },
          files: {
            'flash-toast.AbC_12-x.js': "import './shared.Zz9_8-yq.js'",
            'shared.Zz9_8-yq.js': 'export {}',
          },
        },
      },
      warn: vi.fn(),
    })
    expect(await v.render('page')).toContain('src="/_kick/c/flash-toast.AbC_12-x.js"')
    expect(await v.clientScript('flash-toast.AbC_12-x.js')).toBe("import './shared.Zz9_8-yq.js'")
    expect(await v.clientScript('shared.Zz9_8-yq.js')).toBe('export {}')
    for (const bad of ['../x.js', 'a/b.js', 'x.js', 'shared.Zz9_8-yq.js.map'])
      expect(await v.clientScript(bad)).toBeUndefined()
  })

  it('links bundled CSS in the head and serves it as CSS', async () => {
    const files = {
      'components/flash-toast': TOAST,
      page: '<html><head><title>x</title></head><body><flash-toast /></body></html>',
    }
    const p = project(files)
    const v = createViews({
      bundle: {
        v: 1,
        templates: {
          'components/flash-toast': check('components/flash-toast', p).template!,
          page: check('page', p).template!,
        },
        client: {
          entries: { 'flash-toast': 'flash-toast.AbC_12-x.js' },
          css: { 'flash-toast': ['flash-toast.Cs5_12-x.css'] },
          files: {
            'flash-toast.AbC_12-x.js': 'export {}',
            'flash-toast.Cs5_12-x.css': 'kick-toast{color:red}',
          },
        },
      },
      warn: vi.fn(),
    })
    const html = await v.render('page', { cspNonce: 'n1' })
    expect(html).toContain(
      '<link rel="stylesheet" href="/_kick/c/flash-toast.Cs5_12-x.css" nonce="n1"></head>',
    )
    const res = await clientScriptResponse(
      v,
      new Request('http://x/_kick/c/flash-toast.Cs5_12-x.css'),
    )
    expect(res?.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await res?.text()).toBe('kick-toast{color:red}')
    // Only bundled files are CSS: no per-component CSS name.
    expect(await v.clientScript('flash-toast.00000000.css')).toBeUndefined()
  })

  it('imports need a bundler', async () => {
    const files = {
      'components/flash-toast':
        "<kick-toast></kick-toast>\n<script client>\nimport { a } from './a'\n</script>",
      page: '<flash-toast />',
    }
    await expect(
      createViews({ viewsDir: dir(files), warn: vi.fn() }).render('page'),
    ).rejects.toThrow('client scripts that import need kick dev or a kick build')
    // kick dev (bundle: null): the Vite plugin serves it.
    expect(
      await createViews({ viewsDir: dir(files), bundle: null, warn: vi.fn() }).render('page'),
    ).toContain('/_kick/c/flash-toast.')
  })

  it("comments and strings that mention import aren't imports", async () => {
    const code = [
      '// import later',
      '/*',
      "import { b } from './b'",
      '*/',
      'const s: string = "import x from \'y\'"',
      'const t = `',
      "import('./c')`",
      'console.log(s, t, import.meta.url)',
    ].join('\n')
    const v = createViews({
      viewsDir: dir({
        'components/flash-toast': `<kick-toast></kick-toast>\n<script client>\n${code}\n</script>`,
        page: '<flash-toast />',
      }),
      warn: vi.fn(),
    })
    expect(await v.render('page')).toContain('/_kick/c/flash-toast.')
  })

  it('finds imports inside template literal expressions', async () => {
    const { hasImports } = await import('../src/client-scripts')
    expect(hasImports("const s = `x ${import('./helper.js')} y`")).toBe(true)
    expect(hasImports("const s = `a ${`b ${import('./deep.js')}`} c`")).toBe(true)
    expect(hasImports("const s = `import('./x') ${'import(1)'} ${{ a: 1 }.a}`")).toBe(false)
  })

  it('kick dev leaves type stripping to Vite', async () => {
    const v = createViews({
      viewsDir: dir({ 'components/flash-toast': TOAST, page: '<flash-toast />' }),
      bundle: null,
      stripTypes: () => {
        throw new Error('no stripper')
      },
      warn: vi.fn(),
    })
    expect(await v.render('page')).toMatch(/\/_kick\/c\/flash-toast\.[0-9a-f]{8}\.js/)
  })
})

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-client-'))
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, `${name}.kick`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

const TOAST = `<kick-toast><p>hi</p></kick-toast>\n<script client>${TOAST_SCRIPT}</script>`
const TAG =
  /<script type="module" src="\/_kick\/c\/flash-toast\.[0-9a-f]{8}\.js"( nonce="[^"]*")?><\/script>/g

describe('pages ship client scripts', () => {
  const views = (pages: Record<string, string>, opts = {}) =>
    createViews({
      viewsDir: dir({ 'components/flash-toast': TOAST, ...pages }),
      warn: vi.fn(),
      ...opts,
    })

  it('only rendered components ship their script', async () => {
    const v = views({ page: '<html><body>@if (show) { <flash-toast /> }</body></html>' })
    expect(await v.render('page', { show: false })).not.toContain('<script')
    const html = await v.render('page', { show: true })
    expect(html.match(TAG)).toHaveLength(1)
    expect(html).toMatch(/<\/script><\/body><\/html>$/)
  })

  it('one tag per component, from pages, layouts and components', async () => {
    const v = views({
      'layouts/main': '<html><body><flash-toast /><slot /></body></html>',
      'components/toast-box': '<div><flash-toast /></div>',
      page: "@layout('layouts/main')\n@for (i of items; track i) { <flash-toast /> }<toast-box />",
    })
    expect((await v.render('page', { items: [1, 2, 3] })).match(TAG)).toHaveLength(1)
  })

  it('serves the stripped script by its hashed name', async () => {
    const v = views({ page: '<flash-toast />' })
    const file = (await v.render('page')).match(/flash-toast\.[0-9a-f]{8}\.js/)![0]
    const js = await v.clientScript(file)
    expect(js).toContain("customElements.define('kick-toast'")
    expect(js).not.toContain(': number')
    expect(await v.clientScript('flash-toast.00000000.js')).toBeUndefined()
    expect(await v.clientScript('../x.js')).toBeUndefined()
  })

  it("adds the page's nonce", async () => {
    const v = views({ page: '<flash-toast />' })
    expect(await v.render('page', { cspNonce: 'abc' })).toContain('nonce="abc"')
  })

  it('a missing type stripper only fails pages that need it', async () => {
    const message = 'client scripts need Node 22.13+ to strip TypeScript, or a kick build'
    const v = views(
      { page: '<flash-toast />', plain: '<p>ok</p>' },
      {
        stripTypes: () => {
          throw new Error(message)
        },
      },
    )
    await expect(v.render('page')).rejects.toThrow(message)
    expect(await v.render('plain')).toBe('<p>ok</p>')
  })
})

describe('review fixes', () => {
  const views = (pages: Record<string, string>, opts = {}) =>
    createViews({ viewsDir: dir(pages), warn: vi.fn(), ...opts })

  it('takes the nonce from share() too', async () => {
    const v = views(
      { 'components/flash-toast': TOAST, page: '<flash-toast />' },
      { share: () => ({ cspNonce: 'shared' }) },
    )
    expect(await v.render('page')).toContain('nonce="shared"')
  })

  it('accepts the TypeScript a build accepts, enums included', async () => {
    const v = views({
      'components/mode-box':
        '<div></div>\n<script client>\nenum Mode { A, B }\nconsole.log(Mode.B)\n</script>',
      page: '<mode-box />',
    })
    const file = (await v.render('page')).match(/mode-box\.[0-9a-f]{8}\.js/)![0]
    expect(await v.clientScript(file)).toContain('Mode')
  })

  it("refuses a client script whose component name can't be served", () => {
    expect(
      errors(
        { 'components/my_toast-box': '<div></div><script client>let a = 1</script>' },
        'components/my_toast-box',
      ),
    ).toContain(
      "<script client> needs a component name of lowercase letters, digits and dashes: 'my_toast-box'",
    )
  })

  it('refuses client with a value', () => {
    expect(
      errors(
        { 'components/a-b': '<div></div><script client="true">let a = 1</script>' },
        'components/a-b',
      ),
    ).toContain('write <script client> with no value')
  })
})

describe('injectScripts', () => {
  it('finds </body> by position in the original text', async () => {
    const { injectScripts } = await import('../src/client-scripts')
    expect(injectScripts('<body>İİ</BODY>', '<s>')).toBe('<body>İİ<s></BODY>')
  })
})
