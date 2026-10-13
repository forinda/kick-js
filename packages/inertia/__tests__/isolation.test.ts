import 'reflect-metadata'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { Application, Controller, Get } from '@forinda/kickjs'
import { InertiaAdapter, inertia } from '@forinda/kickjs-inertia'

/** Two apps in one process each render with their own adapter. */
function clientBuild(file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-inertia-iso-'))
  mkdirSync(join(dir, '.vite'))
  writeFileSync(
    join(dir, '.vite', 'manifest.json'),
    JSON.stringify({ 'src/client/main.tsx': { file: `assets/${file}` } }),
  )
  return dir
}

async function makeApp(name: string) {
  @Controller()
  class Pages {
    @Get('/')
    home() {
      return inertia('Home')
    }
  }
  const app = new Application({
    modules: [
      { routes: () => ({ path: '/', prefix: false, version: false, controller: Pages }) } as never,
    ],
    adapters: [
      InertiaAdapter({
        clientDir: clientBuild(`${name}.js`),
        title: name,
        share: () => ({ app: name }),
      }),
    ],
  })
  await app.setup()
  return app
}

describe('two Inertia apps in one process', () => {
  it('render with their own shared props, assets and title', async () => {
    const a = await makeApp('alpha')
    const b = await makeApp('beta')
    const resA = await request(a.handle.bind(a)).get('/').expect(200)
    const resB = await request(b.handle.bind(b)).get('/').expect(200)
    expect(resA.text).toContain('<title>alpha</title>')
    expect(resA.text).toContain('/assets/alpha.js')
    expect(resA.text).toContain('"app":"alpha"')
    expect(resB.text).toContain('<title>beta</title>')
    expect(resB.text).toContain('/assets/beta.js')
    expect(resB.text).toContain('"app":"beta"')
  })

  it('keep working after the other one shuts down', async () => {
    const a = await makeApp('alpha')
    const b = await makeApp('beta')
    await a.shutdown({ closeServer: false })
    const res = await request(b.handle.bind(b)).get('/').expect(200)
    expect(res.text).toContain('"app":"beta"')
  })

  it('escapes the title in the HTML shell', async () => {
    const app = await makeApp('A & B </title><script>x</script>')
    const res = await request(app.handle.bind(app)).get('/').expect(200)
    expect(res.text).toContain(
      '<title>A &amp; B &lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>',
    )
  })
})
