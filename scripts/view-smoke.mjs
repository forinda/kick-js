// `.kick` views on Bun and Deno: render a page with a layout, a component and
// a pipe from the built package, reading templates from disk.
// Run from the repo root: `bun scripts/view-smoke.mjs` / `deno run -A scripts/view-smoke.mjs`.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createViews } from '../packages/view/dist/index.js'

const dir = mkdtempSync(join(tmpdir(), 'kick-view-smoke-'))
const files = {
  'home.kick': "@layout('layouts/main')\n<x-hello [name]=\"name\" />{{ price | currency:'KES' }}",
  'layouts/main.kick': '<main><slot /></main>',
  'components/x-hello.kick': '@input name\n<h1>Hi {{ name | titlecase }}</h1>',
}
for (const [name, src] of Object.entries(files)) {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), src)
}

const views = createViews({ viewsDir: dir, pipes: {} })
const html = await views.render('home', { name: 'ada lovelace', price: 1500 })
const expected = '<main><h1>Hi Ada Lovelace</h1>KES'
if (!html.startsWith(expected) || !html.includes('1,500.00')) {
  console.error('unexpected output:', html)
  process.exit(1)
}
console.log('view smoke test passed:', html)
